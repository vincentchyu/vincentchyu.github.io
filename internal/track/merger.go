package track

import (
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

// FusionPoint 融合内部点位
type FusionPoint struct {
	Lat       float64
	Lon       float64
	Ele       float64
	Time      time.Time
	HeartRate int
	Speed     float64
	IsPrimary bool
}

// MergeResult 合并执行结果统计
type MergeResult struct {
	ActiveFile      string    `json:"active_file"`
	PendingFiles    []string  `json:"pending_files"`
	OriginalPoints  int       `json:"original_points"`
	MergedPoints    int       `json:"merged_points"`
	FilledPoints    int       `json:"filled_points"`     // 真正弥补主轨迹盲区缺失的点数
	InterpolatedHR  int       `json:"interpolated_hr"`   // 成功注入/插值心率的点数
	AvgHRAfter      int       `json:"avg_hr_after"`
	MaxHRAfter      int       `json:"max_hr_after"`
	DistanceKm      float64   `json:"distance_km"`
	ElevationGainM  float64   `json:"elevation_gain_m"`
	StartTime       time.Time `json:"start_time"`
	EndTime         time.Time `json:"end_time"`
	OutputFile      string    `json:"output_file"`
}

// ExtractPointsFromGPX 读取 GPX 文件并提取点位列表
func ExtractPointsFromGPX(filePath string, isPrimary bool) ([]FusionPoint, string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, "", err
	}
	defer f.Close()

	data, err := io.ReadAll(f)
	if err != nil {
		return nil, "", err
	}

	var doc gpxDoc
	if err := xml.Unmarshal(data, &doc); err != nil {
		return nil, "", fmt.Errorf("xml unmarshal failed for %s: %w", filePath, err)
	}

	title := ""
	if doc.Metadata != nil && doc.Metadata.Name != "" {
		title = doc.Metadata.Name
	}
	if title == "" && len(doc.Tracks) > 0 && doc.Tracks[0].Name != "" {
		title = doc.Tracks[0].Name
	}

	var points []FusionPoint
	for _, trk := range doc.Tracks {
		for _, seg := range trk.Segments {
			for _, pt := range seg.Points {
				if pt.Lat == 0 && pt.Lon == 0 {
					continue
				}

				t, err := parseFlexibleTime(pt.Time)
				if err != nil || t.IsZero() {
					continue
				}

				hrVal := 0
				if pt.InnerXML != "" {
					matches := hrRegex.FindStringSubmatch(pt.InnerXML)
					if len(matches) > 1 {
						var v int
						if n, _ := fmt.Sscanf(matches[1], "%d", &v); n == 1 && v > 0 {
							hrVal = v
						}
					}
				}

				points = append(points, FusionPoint{
					Lat:       pt.Lat,
					Lon:       pt.Lon,
					Ele:       pt.Ele,
					Time:      t,
					HeartRate: hrVal,
					Speed:     pt.Speed,
					IsPrimary: isPrimary,
				})
			}
		}
	}

	return points, title, nil
}

// MergeOptions 合并配置选项
type MergeOptions struct {
	BackupActive bool `json:"backup_active"` // 是否备份原文件 (.bak)
	PreferApple  bool `json:"prefer_apple"`  // 是否优先使用 Apple Watch 高精轨迹作为主骨架（两步路用于段间桥接缝合）
}

// MergeGPXTracks 兼容默认入口 (默认主文件骨架优先)
func MergeGPXTracks(activeFilePath string, pendingFilePaths []string, backupActive bool) (*MergeResult, error) {
	return MergeGPXTracksWithOptions(activeFilePath, pendingFilePaths, MergeOptions{
		BackupActive: backupActive,
		PreferApple:  false,
	})
}

// MergeGPXTracksWithOptions 融合主轨迹与多个副轨迹：
// - 默认模式 (PreferApple=false)：以主轨迹（两步路）为基准骨架，仅在真盲区断点时弥补副轨迹点位，并插值注入心率；
// - 苹果优先模式 (PreferApple=true)：以 Apple Watch 的高精连续轨迹段作为主骨架，多日/多段之间的间隙由两步路点位无缝桥接缝合，保留主轨迹名称与地名。
func MergeGPXTracksWithOptions(activeFilePath string, pendingFilePaths []string, opts MergeOptions) (*MergeResult, error) {
	// 1. 读取主轨迹（两步路）
	primaryPoints, trackTitle, err := ExtractPointsFromGPX(activeFilePath, true)
	if err != nil {
		return nil, fmt.Errorf("read active track error: %w", err)
	}
	if len(primaryPoints) == 0 {
		return nil, fmt.Errorf("active track %s has no valid points", activeFilePath)
	}

	if trackTitle == "" {
		trackTitle = strings.TrimSuffix(filepath.Base(activeFilePath), ".gpx")
	}

	// 确保主轨迹点按时间排序
	sort.Slice(primaryPoints, func(i, j int) bool {
		return primaryPoints[i].Time.Before(primaryPoints[j].Time)
	})

	// 2. 读取所有副轨迹（Apple Watch）
	type SecondarySegment struct {
		FilePath  string
		StartTime time.Time
		EndTime   time.Time
		Points    []FusionPoint
	}

	var secondarySegments []SecondarySegment
	var allSecondaryPoints []FusionPoint
	type HRRecord struct {
		Time time.Time
		HR   int
	}
	var hrRecords []HRRecord

	for _, pPath := range pendingFilePaths {
		pts, _, err := ExtractPointsFromGPX(pPath, false)
		if err != nil || len(pts) == 0 {
			continue
		}
		sort.Slice(pts, func(i, j int) bool {
			return pts[i].Time.Before(pts[j].Time)
		})

		secondarySegments = append(secondarySegments, SecondarySegment{
			FilePath:  pPath,
			StartTime: pts[0].Time,
			EndTime:   pts[len(pts)-1].Time,
			Points:    pts,
		})

		for _, p := range pts {
			if p.HeartRate > 0 {
				hrRecords = append(hrRecords, HRRecord{Time: p.Time, HR: p.HeartRate})
			}
		}
		allSecondaryPoints = append(allSecondaryPoints, pts...)
	}

	// 排序副分段
	sort.Slice(secondarySegments, func(i, j int) bool {
		return secondarySegments[i].StartTime.Before(secondarySegments[j].StartTime)
	})
	sort.Slice(hrRecords, func(i, j int) bool {
		return hrRecords[i].Time.Before(hrRecords[j].Time)
	})

	var finalPoints []FusionPoint
	filledPointsCount := 0

	if opts.PreferApple && len(secondarySegments) > 0 {
		// -------------------------------------------------------------
		// 🍎 模式 A：苹果高精优先模式 (Apple Watch Primary with Bridging)
		// -------------------------------------------------------------
		// 前导延伸：若两步路比第一段 Apple 明显早（>60s），先引入两步路起始点
		firstAppleStart := secondarySegments[0].StartTime
		for _, p := range primaryPoints {
			if p.Time.Before(firstAppleStart.Add(-10 * time.Second)) {
				finalPoints = append(finalPoints, p)
			}
		}

		for idx, seg := range secondarySegments {
			// 将当前 Apple 高精段的所有点按原样全部加入
			finalPoints = append(finalPoints, seg.Points...)

			// 段间桥接：若与下一段 Apple 之间有空档（>60s），用两步路填补
			if idx < len(secondarySegments)-1 {
				currEnd := seg.EndTime
				nextStart := secondarySegments[idx+1].StartTime
				if nextStart.Sub(currEnd).Seconds() > 60.0 {
					for _, p := range primaryPoints {
						if p.Time.After(currEnd.Add(5*time.Second)) && p.Time.Before(nextStart.Add(-5*time.Second)) {
							finalPoints = append(finalPoints, p)
							filledPointsCount++
						}
					}
				}
			}
		}

		// 后尾延伸：若两步路比最后一段 Apple 明显晚（>60s），补充两步路末尾点
		lastAppleEnd := secondarySegments[len(secondarySegments)-1].EndTime
		for _, p := range primaryPoints {
			if p.Time.After(lastAppleEnd.Add(10 * time.Second)) {
				finalPoints = append(finalPoints, p)
			}
		}
	} else {
		// -------------------------------------------------------------
		// 🧭 模式 B：默认主文件骨架优先 (Primary Spine with Gap-Filling)
		// -------------------------------------------------------------
		for i := 0; i < len(primaryPoints); i++ {
			curr := primaryPoints[i]
			finalPoints = append(finalPoints, curr)

			if i == len(primaryPoints)-1 {
				break
			}

			next := primaryPoints[i+1]
			timeGapSec := next.Time.Sub(curr.Time).Seconds()
			distJumpM := HaversineDistance(curr.Lat, curr.Lon, next.Lat, next.Lon)

			// 仅在主轨迹真盲区（>120s 且 >100m）才补入副轨迹点
			if timeGapSec > 120.0 && distJumpM > 100.0 {
				var gapCandidates []FusionPoint
				for _, sp := range allSecondaryPoints {
					if sp.Time.After(curr.Time.Add(5*time.Second)) && sp.Time.Before(next.Time.Add(-5*time.Second)) {
						gapCandidates = append(gapCandidates, sp)
					}
				}

				if len(gapCandidates) > 0 {
					var lastSampleTime time.Time
					for _, gp := range gapCandidates {
						if lastSampleTime.IsZero() || gp.Time.Sub(lastSampleTime).Seconds() >= 5.0 {
							finalPoints = append(finalPoints, gp)
							lastSampleTime = gp.Time
							filledPointsCount++
						}
					}
				}
			}
		}
	}

	// 4. 心率时空对齐与线性插值 (Heart Rate Interpolation)
	interpolatedHRCount := 0
	if len(hrRecords) > 0 {
		hrIdx := 0
		for i := 0; i < len(finalPoints); i++ {
			if finalPoints[i].HeartRate > 0 {
				continue
			}

			ptTime := finalPoints[i].Time

			// 移动心率窗口
			for hrIdx+1 < len(hrRecords) && hrRecords[hrIdx+1].Time.Before(ptTime) {
				hrIdx++
			}

			var prevHR, nextHR *HRRecord
			if hrRecords[hrIdx].Time.Before(ptTime) || hrRecords[hrIdx].Time.Equal(ptTime) {
				prevHR = &hrRecords[hrIdx]
			}
			if hrIdx+1 < len(hrRecords) {
				nextHR = &hrRecords[hrIdx+1]
			} else if hrRecords[hrIdx].Time.After(ptTime) {
				nextHR = &hrRecords[hrIdx]
			}

			// 进行 5 分钟可信时间窗内的线性插值
			if prevHR != nil && nextHR != nil {
				span := nextHR.Time.Sub(prevHR.Time).Seconds()
				if span > 0 && span <= 300.0 {
					ratio := ptTime.Sub(prevHR.Time).Seconds() / span
					interVal := int(math.Round(float64(prevHR.HR) + ratio*float64(nextHR.HR-prevHR.HR)))
					if interVal > 0 {
						finalPoints[i].HeartRate = interVal
						interpolatedHRCount++
					}
				}
			} else if prevHR != nil && ptTime.Sub(prevHR.Time).Seconds() <= 60.0 {
				finalPoints[i].HeartRate = prevHR.HR
				interpolatedHRCount++
			} else if nextHR != nil && nextHR.Time.Sub(ptTime).Seconds() <= 60.0 {
				finalPoints[i].HeartRate = nextHR.HR
				interpolatedHRCount++
			}
		}
	}

	// 5. 重新计算融合后的统计指标（里程、爬升、心率）
	totalDistKm := 0.0
	totalEleGain := 0.0
	totalHR := 0
	validHRCnt := 0
	maxHR := 0

	for i := 0; i < len(finalPoints); i++ {
		if i > 0 {
			distM := HaversineDistance(finalPoints[i-1].Lat, finalPoints[i-1].Lon, finalPoints[i].Lat, finalPoints[i].Lon)
			totalDistKm += distM / 1000.0

			eleDiff := finalPoints[i].Ele - finalPoints[i-1].Ele
			if eleDiff > 0 && eleDiff < 80.0 { // 过滤异常高程跃变
				totalEleGain += eleDiff
			}
		}
		if finalPoints[i].HeartRate > 0 {
			totalHR += finalPoints[i].HeartRate
			validHRCnt++
			if finalPoints[i].HeartRate > maxHR {
				maxHR = finalPoints[i].HeartRate
			}
		}
	}

	avgHRAfter := 0
	if validHRCnt > 0 {
		avgHRAfter = int(math.Round(float64(totalHR) / float64(validHRCnt)))
	}

	// 6. 备份原文件
	if opts.BackupActive {
		backupPath := activeFilePath + ".bak"
		_ = copyFile(activeFilePath, backupPath)
	}

	// 7. 序列化并写入标准 GPX 文件
	if err := WriteStandardGPX(activeFilePath, trackTitle, finalPoints); err != nil {
		return nil, fmt.Errorf("write fused gpx error: %w", err)
	}

	return &MergeResult{
		ActiveFile:     activeFilePath,
		PendingFiles:   pendingFilePaths,
		OriginalPoints: len(primaryPoints),
		MergedPoints:   len(finalPoints),
		FilledPoints:   filledPointsCount,
		InterpolatedHR: interpolatedHRCount,
		AvgHRAfter:     avgHRAfter,
		MaxHRAfter:     maxHR,
		DistanceKm:     math.Round(totalDistKm*100) / 100,
		ElevationGainM: math.Round(totalEleGain),
		StartTime:      finalPoints[0].Time,
		EndTime:        finalPoints[len(finalPoints)-1].Time,
		OutputFile:     activeFilePath,
	}, nil
}

// WriteStandardGPX 序列化融合后的点位并写入标准 GPX 1.1 XML
func WriteStandardGPX(outPath, trackTitle string, points []FusionPoint) error {
	f, err := os.Create(outPath)
	if err != nil {
		return err
	}
	defer f.Close()

	if _, err := f.WriteString("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n"); err != nil {
		return err
	}

	gpxHeader := fmt.Sprintf(`<gpx version="1.1" creator="Vincent Track Fusion Engine" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>%s</name>
    <time>%s</time>
  </metadata>
  <trk>
    <name>%s</name>
    <trkseg>
`, escapeXML(trackTitle), time.Now().UTC().Format(time.RFC3339), escapeXML(trackTitle))

	if _, err := f.WriteString(gpxHeader); err != nil {
		return err
	}

	for _, pt := range points {
		timeStr := pt.Time.UTC().Format(time.RFC3339)
		var ptStr string
		if pt.HeartRate > 0 {
			ptStr = fmt.Sprintf("      <trkpt lat=\"%.6f\" lon=\"%.6f\"><ele>%.1f</ele><time>%s</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>%d</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>\n",
				pt.Lat, pt.Lon, pt.Ele, timeStr, pt.HeartRate)
		} else {
			ptStr = fmt.Sprintf("      <trkpt lat=\"%.6f\" lon=\"%.6f\"><ele>%.1f</ele><time>%s</time></trkpt>\n",
				pt.Lat, pt.Lon, pt.Ele, timeStr)
		}
		if _, err := f.WriteString(ptStr); err != nil {
			return err
		}
	}

	gpxFooter := `    </trkseg>
  </trk>
</gpx>
`
	if _, err := f.WriteString(gpxFooter); err != nil {
		return err
	}

	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

func escapeXML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	s = strings.ReplaceAll(s, "'", "&apos;")
	return s
}

// ConcatSegment 单个分段信息
type ConcatSegment struct {
	FilePath   string        `json:"file_path"`
	Filename   string        `json:"filename"`
	Title      string        `json:"title"`
	StartTime  time.Time     `json:"start_time"`
	EndTime    time.Time     `json:"end_time"`
	Points     []FusionPoint `json:"points"`
	DistanceKm float64       `json:"distance_km"`
}

// ConcatResult 串联结果
type ConcatResult struct {
	OutputFile      string          `json:"output_file"`
	OutputTitle     string          `json:"output_title"`
	Segments        []ConcatSegment `json:"segments"`
	TotalPoints     int             `json:"total_points"`
	TotalDistanceKm float64         `json:"total_distance_km"`
	TotalElevationM float64         `json:"total_elevation_m"`
	AvgHR           int             `json:"avg_hr"`
	MaxHR           int             `json:"max_hr"`
	StartTime       time.Time       `json:"start_time"`
	EndTime         time.Time       `json:"end_time"`
}

// ConcatGPXTracks 将多个单日/分段 GPX 按照时间升序首尾串联为一个完整的大活动 GPX
func ConcatGPXTracks(filePaths []string, outTitle, outFilePath string) (*ConcatResult, error) {
	if len(filePaths) == 0 {
		return nil, fmt.Errorf("no input files provided")
	}

	var segments []ConcatSegment
	for _, p := range filePaths {
		pts, title, err := ExtractPointsFromGPX(p, true)
		if err != nil || len(pts) == 0 {
			continue
		}
		sort.Slice(pts, func(i, j int) bool {
			return pts[i].Time.Before(pts[j].Time)
		})

		distKm := 0.0
		for i := 1; i < len(pts); i++ {
			distKm += HaversineDistance(pts[i-1].Lat, pts[i-1].Lon, pts[i].Lat, pts[i].Lon) / 1000.0
		}

		segments = append(segments, ConcatSegment{
			FilePath:   p,
			Filename:   filepath.Base(p),
			Title:      title,
			StartTime:  pts[0].Time,
			EndTime:    pts[len(pts)-1].Time,
			Points:     pts,
			DistanceKm: math.Round(distKm*100) / 100,
		})
	}

	if len(segments) == 0 {
		return nil, fmt.Errorf("no valid segments could be loaded")
	}

	// 按分段开始时间严格排序 (D1 -> D2 -> D3 ...)
	sort.Slice(segments, func(i, j int) bool {
		return segments[i].StartTime.Before(segments[j].StartTime)
	})

	// 顺次首尾连接所有点位
	var allPoints []FusionPoint
	for _, seg := range segments {
		allPoints = append(allPoints, seg.Points...)
	}

	// 计算统计指标
	totalDistKm := 0.0
	totalEleGain := 0.0
	totalHR := 0
	validHRCnt := 0
	maxHR := 0

	for i := 0; i < len(allPoints); i++ {
		if i > 0 {
			distM := HaversineDistance(allPoints[i-1].Lat, allPoints[i-1].Lon, allPoints[i].Lat, allPoints[i].Lon)
			// 过滤跨天转场夜间产生的巨大跳跃测距（若分段之间时间差 > 6小时且距离 > 10km，视为营地过夜转场，不计入运动里程）
			timeDiffHours := allPoints[i].Time.Sub(allPoints[i-1].Time).Hours()
			if timeDiffHours < 6.0 || distM < 10000.0 {
				totalDistKm += distM / 1000.0
			}

			eleDiff := allPoints[i].Ele - allPoints[i-1].Ele
			if eleDiff > 0 && eleDiff < 80.0 {
				totalEleGain += eleDiff
			}
		}
		if allPoints[i].HeartRate > 0 {
			totalHR += allPoints[i].HeartRate
			validHRCnt++
			if allPoints[i].HeartRate > maxHR {
				maxHR = allPoints[i].HeartRate
			}
		}
	}

	avgHR := 0
	if validHRCnt > 0 {
		avgHR = int(math.Round(float64(totalHR) / float64(validHRCnt)))
	}

	if outTitle == "" {
		outTitle = segments[0].Title
	}

	if err := WriteStandardGPX(outFilePath, outTitle, allPoints); err != nil {
		return nil, fmt.Errorf("write concatenated gpx failed: %w", err)
	}

	return &ConcatResult{
		OutputFile:      outFilePath,
		OutputTitle:     outTitle,
		Segments:        segments,
		TotalPoints:     len(allPoints),
		TotalDistanceKm: math.Round(totalDistKm*100) / 100,
		TotalElevationM: math.Round(totalEleGain),
		AvgHR:           avgHR,
		MaxHR:           maxHR,
		StartTime:       allPoints[0].Time,
		EndTime:         allPoints[len(allPoints)-1].Time,
	}, nil
}
