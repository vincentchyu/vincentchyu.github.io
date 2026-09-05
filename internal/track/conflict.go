package track

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// ConflictType 冲突/重合类型
type ConflictType string

const (
	ConflictExactMatch     ConflictType = "EXACT_MATCH"     // 1对1高度重合（同一活动重复记录）
	ConflictSubTrack       ConflictType = "SUB_TRACK"       // 1对N子轨迹（如多日大线包含单日Apple记录）
	ConflictPartialOverlap ConflictType = "PARTIAL_OVERLAP" // 部分时空重合
)

// GPXQuickSummary 单份 GPX 文件的元数据摘要
type GPXQuickSummary struct {
	FilePath     string       `json:"file_path"`
	Filename     string       `json:"filename"`
	IsPending    bool         `json:"is_pending"`
	Activity     ActivityType `json:"activity_type"`
	Title        string       `json:"title"`
	Creator      string       `json:"creator"`
	StartTime    time.Time    `json:"start_time"`
	EndTime      time.Time    `json:"end_time"`
	DurationS    int64        `json:"duration_s"`
	PointCount   int          `json:"point_count"`
	HasHeartRate bool         `json:"has_heart_rate"`
	AvgHR        int          `json:"avg_hr"`
	MaxHR        int          `json:"max_hr"`
	BoundingBox  BoundingBox  `json:"bbox"` // [minLon, minLat, maxLon, maxLat]
	CenterLon    float64      `json:"center_lon"`
	CenterLat    float64      `json:"center_lat"`
}

// ConflictItem 单个待合并项的关联信息
type ConflictItem struct {
	PendingFile     string       `json:"pending_file"`
	PendingFilename string       `json:"pending_filename"`
	ConflictType    ConflictType `json:"conflict_type"`
	OverlapDuration int64        `json:"overlap_duration_s"` // 重叠秒数
	OverlapRatio    float64      `json:"overlap_ratio"`      // 重叠比例 (0.0 ~ 1.0)
	PendingPoints   int          `json:"pending_points"`
	PendingHasHR    bool         `json:"pending_has_hr"`
	PendingAvgHR    int          `json:"pending_avg_hr"`
	PendingMaxHR    int          `json:"pending_max_hr"`
	PendingStart    string       `json:"pending_start"`
	PendingEnd      string       `json:"pending_end"`
}

// ConflictGroup 聚合后的冲突组（以正式包主轨迹为主键）
type ConflictGroup struct {
	GroupID        string         `json:"group_id"`        // 唯一组标识 (如 grp_20241002_五台山顺朝台)
	ActiveFile     string         `json:"active_file"`     // 正式包主文件路径
	ActiveFilename string         `json:"active_filename"` // 正式包文件名
	ActiveTitle    string         `json:"active_title"`    // 活动标题
	ActiveActivity ActivityType   `json:"active_activity"` // 运动类型
	ActiveStart    string         `json:"active_start"`
	ActiveEnd      string         `json:"active_end"`
	ActivePoints   int            `json:"active_points"`
	ActiveHasHR    bool           `json:"active_has_hr"`
	PendingItems   []ConflictItem `json:"pending_items"` // 关联的待合并预备包列表
	TotalPendingHR bool           `json:"total_pending_hr"`
	SuggestAction  string         `json:"suggest_action"` // 推荐操作 (如 "MERGE_HR_AND_FILL_GAPS", "MERGE_AND_DEDUPLICATE")
}

// ConflictsManifest 冲突清单清单文件结构
type ConflictsManifest struct {
	GeneratedAt    string          `json:"generated_at"`
	ActiveDir      string          `json:"active_dir"`
	PendingDir     string          `json:"pending_dir"`
	FilterActivity ActivityType    `json:"filter_activity,omitempty"` // 过滤的运动类型 (空表示全类型)
	TotalActive    int             `json:"total_active"`
	TotalPending   int             `json:"total_pending"`
	ConflictGroups []ConflictGroup `json:"conflict_groups"`
}

// ParseQuickSummary 快速提取 GPX 核心元数据（轻量扫描）
func ParseQuickSummary(filePath string, isPending bool) (*GPXQuickSummary, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	data, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}

	var doc gpxDoc
	if err := xml.Unmarshal(data, &doc); err != nil {
		return nil, err
	}

	var firstTime, lastTime time.Time
	minLat, maxLat := 90.0, -90.0
	minLon, maxLon := 180.0, -180.0
	ptCount := 0
	totalHR := 0
	validHRCnt := 0
	maxHR := 0

	title := ""
	if doc.Metadata != nil && doc.Metadata.Name != "" {
		title = doc.Metadata.Name
	}

	for _, trk := range doc.Tracks {
		if title == "" && trk.Name != "" {
			title = trk.Name
		}
		for _, seg := range trk.Segments {
			for _, pt := range seg.Points {
				ptCount++
				if pt.Lat < minLat {
					minLat = pt.Lat
				}
				if pt.Lat > maxLat {
					maxLat = pt.Lat
				}
				if pt.Lon < minLon {
					minLon = pt.Lon
				}
				if pt.Lon > maxLon {
					maxLon = pt.Lon
				}

				if pt.Time != "" {
					t, err := parseFlexibleTime(pt.Time)
					if err == nil && !t.IsZero() {
						if firstTime.IsZero() || t.Before(firstTime) {
							firstTime = t
						}
						if lastTime.IsZero() || t.After(lastTime) {
							lastTime = t
						}
					}
				}

				if pt.InnerXML != "" {
					matches := hrRegex.FindStringSubmatch(pt.InnerXML)
					if len(matches) > 1 {
						var hrVal int
						if n, _ := fmt.Sscanf(matches[1], "%d", &hrVal); n == 1 && hrVal > 0 {
							totalHR += hrVal
							validHRCnt++
							if hrVal > maxHR {
								maxHR = hrVal
							}
						}
					}
				}
			}
		}
	}

	if ptCount == 0 {
		return nil, fmt.Errorf("no track points in %s", filePath)
	}

	avgHR := 0
	if validHRCnt > 0 {
		avgHR = int(math.Round(float64(totalHR) / float64(validHRCnt)))
	}

	baseName := filepath.Base(filePath)
	actType := inferActivityTypeFromFilename(baseName)

	var durS int64 = 0
	if !firstTime.IsZero() && !lastTime.IsZero() && lastTime.After(firstTime) {
		durS = int64(lastTime.Sub(firstTime).Seconds())
	}

	return &GPXQuickSummary{
		FilePath:     filePath,
		Filename:     baseName,
		IsPending:    isPending,
		Activity:     actType,
		Title:        title,
		Creator:      doc.Creator,
		StartTime:    firstTime,
		EndTime:      lastTime,
		DurationS:    durS,
		PointCount:   ptCount,
		HasHeartRate: validHRCnt > 0,
		AvgHR:        avgHR,
		MaxHR:        maxHR,
		BoundingBox:  BoundingBox{minLon, minLat, maxLon, maxLat},
		CenterLon:    (minLon + maxLon) / 2.0,
		CenterLat:    (minLat + maxLat) / 2.0,
	}, nil
}

func inferActivityTypeFromFilename(filename string) ActivityType {
	lower := strings.ToLower(filename)
	switch {
	case strings.HasPrefix(lower, "trail_running") || strings.Contains(lower, "越野跑"):
		return TypeTrailRunning
	case strings.HasPrefix(lower, "hiking") || strings.Contains(lower, "徒步") || strings.Contains(lower, "朝台"):
		return TypeHiking
	case strings.HasPrefix(lower, "running") || strings.Contains(lower, "跑步") || strings.Contains(lower, "joyrun"):
		return TypeRunning
	case strings.HasPrefix(lower, "cycling") || strings.Contains(lower, "骑行"):
		return TypeCycling
	case strings.HasPrefix(lower, "driving") || strings.Contains(lower, "自驾"):
		return TypeDriving
	case strings.HasPrefix(lower, "walking") || strings.Contains(lower, "行走") || strings.Contains(lower, "散步"):
		return TypeWalking
	case strings.HasPrefix(lower, "transit") || strings.Contains(lower, "旅行"):
		return TypeTransit
	default:
		return TypeHiking
	}
}

// CheckSpatiotemporalOverlap 检测两份 GPX 的时空重合度
func CheckSpatiotemporalOverlap(active, pending *GPXQuickSummary) (bool, ConflictType, time.Duration, float64) {
	if active.StartTime.IsZero() || active.EndTime.IsZero() || pending.StartTime.IsZero() || pending.EndTime.IsZero() {
		return false, "", 0, 0
	}

	// 1. 空间相交检查 (BBox)
	if active.BoundingBox[0] > pending.BoundingBox[2] || active.BoundingBox[2] < pending.BoundingBox[0] ||
		active.BoundingBox[1] > pending.BoundingBox[3] || active.BoundingBox[3] < pending.BoundingBox[1] {
		// BBox 完全不相交
		return false, "", 0, 0
	}

	// 2. 时间重叠区间计算
	start := active.StartTime
	if pending.StartTime.After(start) {
		start = pending.StartTime
	}
	end := active.EndTime
	if pending.EndTime.Before(end) {
		end = pending.EndTime
	}

	if !end.After(start) {
		// 时间没有交集
		return false, "", 0, 0
	}

	overlapDur := end.Sub(start)
	pendingDur := pending.EndTime.Sub(pending.StartTime)
	activeDur := active.EndTime.Sub(active.StartTime)

	if pendingDur <= 0 {
		return false, "", 0, 0
	}

	overlapRatio := float64(overlapDur) / float64(pendingDur)

	// 重叠时长小于 3 分钟且比例低于 10% 视为偶然相交
	if overlapDur < 3*time.Minute && overlapRatio < 0.1 {
		return false, "", 0, 0
	}

	// 3. 细分冲突类型
	if overlapRatio >= 0.85 && float64(overlapDur)/float64(activeDur) >= 0.85 {
		return true, ConflictExactMatch, overlapDur, overlapRatio
	}

	if overlapRatio >= 0.70 && activeDur > pendingDur*2 {
		// 主轨迹跨度大很多，pending 是其子段
		return true, ConflictSubTrack, overlapDur, overlapRatio
	}

	return true, ConflictPartialOverlap, overlapDur, overlapRatio
}

// ScanConflicts 扫描并生成所有运动类型的冲突清单
func ScanConflicts(activeDir, pendingDir string) (*ConflictsManifest, error) {
	return ScanConflictsWithType(activeDir, pendingDir, "")
}

// ScanConflictsWithType 扫描指定运动类型（如 hiking, running, cycling）的冲突清单
func ScanConflictsWithType(activeDir, pendingDir string, filterType ActivityType) (*ConflictsManifest, error) {
	activeFiles, err := filepath.Glob(filepath.Join(activeDir, "*.gpx"))
	if err != nil {
		return nil, err
	}
	pendingFiles, err := filepath.Glob(filepath.Join(pendingDir, "*.gpx"))
	if err != nil {
		return nil, err
	}

	var activeSummaries []*GPXQuickSummary
	for _, f := range activeFiles {
		if s, err := ParseQuickSummary(f, false); err == nil {
			if filterType == "" || s.Activity == filterType {
				activeSummaries = append(activeSummaries, s)
			}
		}
	}

	var pendingSummaries []*GPXQuickSummary
	for _, f := range pendingFiles {
		if s, err := ParseQuickSummary(f, true); err == nil {
			pendingSummaries = append(pendingSummaries, s)
		}
	}

	groupMap := make(map[string]*ConflictGroup)

	for _, p := range pendingSummaries {
		for _, a := range activeSummaries {
			isOverlap, cType, dur, ratio := CheckSpatiotemporalOverlap(a, p)
			if !isOverlap {
				continue
			}

			groupID := generateGroupID(a.Filename)
			grp, exists := groupMap[groupID]
			if !exists {
				grp = &ConflictGroup{
					GroupID:        groupID,
					ActiveFile:     a.FilePath,
					ActiveFilename: a.Filename,
					ActiveTitle:    a.Title,
					ActiveActivity: a.Activity,
					ActiveStart:    a.StartTime.Local().Format("2006-01-02 15:04:05"),
					ActiveEnd:      a.EndTime.Local().Format("2006-01-02 15:04:05"),
					ActivePoints:   a.PointCount,
					ActiveHasHR:    a.HasHeartRate,
					PendingItems:   []ConflictItem{},
				}
				groupMap[groupID] = grp
			}

			grp.PendingItems = append(grp.PendingItems, ConflictItem{
				PendingFile:     p.FilePath,
				PendingFilename: p.Filename,
				ConflictType:    cType,
				OverlapDuration: int64(dur.Seconds()),
				OverlapRatio:    ratio,
				PendingPoints:   p.PointCount,
				PendingHasHR:    p.HasHeartRate,
				PendingAvgHR:    p.AvgHR,
				PendingMaxHR:    p.MaxHR,
				PendingStart:    p.StartTime.Local().Format("2006-01-02 15:04:05"),
				PendingEnd:      p.EndTime.Local().Format("2006-01-02 15:04:05"),
			})

			if p.HasHeartRate {
				grp.TotalPendingHR = true
			}
		}
	}

	var groups []ConflictGroup
	for _, grp := range groupMap {
		if grp.TotalPendingHR && !grp.ActiveHasHR {
			grp.SuggestAction = "MERGE_HR_AND_FILL_GAPS" // 推荐注入心率并弥补点位
		} else if grp.TotalPendingHR && grp.ActiveHasHR {
			grp.SuggestAction = "MERGE_HIGH_PRECISION_HR"
		} else {
			grp.SuggestAction = "MERGE_AND_DEDUPLICATE"
		}
		groups = append(groups, *grp)
	}

	sort.Slice(groups, func(i, j int) bool {
		return groups[i].ActiveStart > groups[j].ActiveStart
	})

	manifest := &ConflictsManifest{
		GeneratedAt:    time.Now().Format("2006-01-02 15:04:05"),
		ActiveDir:      activeDir,
		PendingDir:     pendingDir,
		FilterActivity: filterType,
		TotalActive:    len(activeSummaries),
		TotalPending:   len(pendingSummaries),
		ConflictGroups: groups,
	}

	return manifest, nil
}

func generateGroupID(filename string) string {
	clean := strings.TrimSuffix(filename, ".gpx")
	parts := strings.Split(clean, "-")
	if len(parts) >= 4 {
		return fmt.Sprintf("grp_%s_%s", parts[len(parts)-1], parts[len(parts)-2])
	}
	return "grp_" + clean
}

// SaveManifestToFile 保存清单为 JSON 文件
func (m *ConflictsManifest) SaveManifestToFile(outPath string) error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(outPath, data, 0644)
}
