package track

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/vincentchyu/photools/pkg/geocoding"
)

// GPX XML 结构定义
type gpxDoc struct {
	XMLName  xml.Name     `xml:"gpx"`
	Creator  string       `xml:"creator,attr"`
	Metadata *gpxMetadata `xml:"metadata"`
	Tracks   []gpxTrack   `xml:"trk"`
	Waypts   []gpxPoint   `xml:"wpt"`
	Routes   []gpxRoute   `xml:"rte"`
}

type gpxMetadata struct {
	Name string `xml:"name"`
	Time string `xml:"time"`
}

type gpxTrack struct {
	Name     string       `xml:"name"`
	Type     string       `xml:"type"`
	Segments []gpxSegment `xml:"trkseg"`
}

type gpxSegment struct {
	Points []gpxPoint `xml:"trkpt"`
}

type gpxRoute struct {
	Name   string     `xml:"name"`
	Type   string     `xml:"type"`
	Points []gpxPoint `xml:"rtept"`
}

type gpxPoint struct {
	Lat      float64 `xml:"lat,attr"`
	Lon      float64 `xml:"lon,attr"`
	Ele      float64 `xml:"ele"`
	Time     string  `xml:"time"`
	Speed    float64 `xml:"speed"`
	InnerXML string  `xml:",innerxml"`
}

var hrRegex = regexp.MustCompile(`<(?:[a-zA-Z0-9_-]+:)?(?:hr|heartrate)>([0-9]+)</`)

// ParseTime 灵活解析各类时间格式
func parseFlexibleTime(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, nil
	}
	formats := []string{
		time.RFC3339,
		time.RFC3339Nano,
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05-07:00",
		"2006-01-02T15:04:05.999999999Z",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, f := range formats {
		if t, err := time.Parse(f, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unknown time format: %s", s)
}

// ParseGPXFile 读取并解析单份 GPX 文件（使用默认/全局配置）
// 返回 (详情模型, Manifest元数据清单项, 全景骨架坐标, 错误)
func ParseGPXFile(filePath string) (*TrackDetail, *TrackManifestItem, [][]float64, error) {
	return ParseGPXFileWithConfig(filePath, nil)
}

// ParseGPXFileWithConfig 读取并解析单份 GPX 文件（支持传入自定义 TrackConfig 阈值配置）
func ParseGPXFileWithConfig(filePath string, cfg *TrackConfig) (*TrackDetail, *TrackManifestItem, [][]float64, error) {
	if cfg == nil {
		cfg = DefaultTrackConfig()
	}
	f, err := os.Open(filePath)
	if err != nil {
		return nil, nil, nil, err
	}
	defer f.Close()

	data, err := io.ReadAll(f)
	if err != nil {
		return nil, nil, nil, err
	}

	var doc gpxDoc
	if err := xml.Unmarshal(data, &doc); err != nil {
		return nil, nil, nil, fmt.Errorf("xml unmarshal error: %w", err)
	}

	// 提取全部原始点位
	var rawPoints []RawPoint
	trackName := ""
	trackType := ""

	// 优先从 Tracks 中提取
	for _, trk := range doc.Tracks {
		if trackName == "" && trk.Name != "" {
			trackName = trk.Name
		}
		if trackType == "" && trk.Type != "" {
			trackType = trk.Type
		}
		for _, seg := range trk.Segments {
			for _, pt := range seg.Points {
				rp := convertPoint(pt)
				rawPoints = append(rawPoints, rp)
			}
		}
	}

	// 兼容 Routes
	if len(rawPoints) == 0 {
		for _, rte := range doc.Routes {
			if trackName == "" && rte.Name != "" {
				trackName = rte.Name
			}
			for _, pt := range rte.Points {
				rawPoints = append(rawPoints, convertPoint(pt))
			}
		}
	}

	// 兼容只有 Waypoints 的记录
	if len(rawPoints) == 0 && len(doc.Waypts) > 0 {
		for _, pt := range doc.Waypts {
			rawPoints = append(rawPoints, convertPoint(pt))
		}
	}

	if len(rawPoints) < 2 {
		return nil, nil, nil, fmt.Errorf("no valid gps points found in %s", filepath.Base(filePath))
	}

	baseName := strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))
	stdInfo, isStandard := ParseStandardFilename(baseName)

	var actType ActivityType
	if isStandard {
		// 1. 标准化文件名（最高优先级）：直接使用人工确认的标准字段
		trackName = stdInfo.Title
		actType = stdInfo.ActivityType
	} else if trackName == "" {
		// 2. 非标准化文件名兜底：从元数据或清洗文件名提取
		if doc.Metadata != nil && doc.Metadata.Name != "" {
			trackName = doc.Metadata.Name
		} else {
			trackName = cleanFilenameTitle(baseName)
		}
		actType = normalizeActivityType(trackType)
	}

	// 生成稳定唯一 ID（基于相对文件名或内容哈希）
	hasher := sha1.New()
	hasher.Write([]byte(baseName))
	id := hex.EncodeToString(hasher.Sum(nil))[:12]

	// 计算地理统计指标
	startTime := rawPoints[0].Time
	if startTime.IsZero() {
		// 尝试从文件名提取日期或使用当前时间
		if isStandard && stdInfo.HasDate {
			startTime = stdInfo.Date
		} else if t, err := extractDateFromText(baseName); err == nil {
			startTime = t
		} else {
			startTime = time.Now()
		}
	}

	// 1. 高程数据清洗与平滑滤波（修复 GPS 未定位 0 值、异常噪点、消除抖动并计算真实爬升与最高最低海拔）
	cleanedPoints, totalElevationGain, totalElevationLoss, minEle, maxEle := SanitizeAndSmoothElevations(rawPoints)
	rawPoints = cleanedPoints
	eleSpan := maxEle - minEle

	// 2. 距离计算（使用 2.0 米容差的抽稀数据来计算距离，消除原地踏步和 GPS 高频抖动导致的里程虚高偏差）
	// 同时引入速度阈值过滤：自动剔除中途坐环保车/开车等因未及时暂停导致的异常跳变距离
	distPoints := DouglasPeucker(rawPoints, 2.0)
	var totalDistance float64
	for i := range distPoints {
		if i > 0 {
			prev := distPoints[i-1]
			d := HaversineDistance(prev.Lat, prev.Lon, distPoints[i].Lat, distPoints[i].Lon)

			// 数学公式：通过时空关系反推速度，过滤乘坐交通工具的虚假里程
			if !distPoints[i].Time.IsZero() && !prev.Time.IsZero() {
				dt := distPoints[i].Time.Sub(prev.Time).Seconds()
				if dt > 0 {
					speedKmh := (d / dt) * 3.6
					// 针对步行和徒步，如果速度超过 15 km/h（人类不可能达到的步行速度），判定为乘坐了交通工具，该段距离不计入
					if (actType == TypeWalking || actType == TypeHiking) && speedKmh > 15.0 {
						continue
					}
					// 针对跑步，如果速度超过 25 km/h，判定为坐车，不计入
					if actType == TypeRunning && speedKmh > 25.0 {
						continue
					}
				}
			}

			totalDistance += d
		}
	}

	var durationSeconds int64
	lastTime := rawPoints[len(rawPoints)-1].Time
	if !startTime.IsZero() && !lastTime.IsZero() && lastTime.After(startTime) {
		durationSeconds = int64(lastTime.Sub(startTime).Seconds())
	} else {
		// 估算耗时（默认平均速度 5km/h）
		durationSeconds = int64((totalDistance / 1000.0) / 5.0 * 3600.0)
	}

	distanceKm := totalDistance / 1000.0
	var avgSpeedKmh float64
	if durationSeconds > 0 {
		avgSpeedKmh = (distanceKm / float64(durationSeconds)) * 3600.0
	}

	// 统计心率
	var sumHR, countHR, maxHR int
	for _, p := range rawPoints {
		if p.HeartRate >= 40 && p.HeartRate <= 230 {
			sumHR += p.HeartRate
			countHR++
			if p.HeartRate > maxHR {
				maxHR = p.HeartRate
			}
		}
	}
	avgHR := 0
	if countHR > 0 {
		avgHR = int(math.Round(float64(sumHR) / float64(countHR)))
	}

	var country, province, city string

	loc := QueryLocation(rawPoints[0].Lat, rawPoints[0].Lon)
	inferredType := resolveActivityType(trackName, trackType, avgSpeedKmh, totalElevationGain, distanceKm, eleSpan, maxEle, loc)
	inferredCountry, inferredProvince, inferredCity := DetectRegion(rawPoints[0].Lat, rawPoints[0].Lon, rawPoints[0].Elevation)

	if isStandard {
		actType = stdInfo.ActivityType
		country = stdInfo.Country
		province = stdInfo.Province
		city = inferredCity

		// 冲突纠偏防御（针对城市生活区平地路跑/散步被历史脚本误标为越野跑或山地徒步的情况自动纠偏）
		if actType == TypeTrailRunning && inferredType == TypeRunning {
			actType = TypeRunning
		}
		if actType == TypeHiking && inferredType == TypeWalking {
			actType = TypeWalking
		}
	} else {
		actType = inferredType
		country = inferredCountry
		province = inferredProvince
		city = inferredCity
	}

	// 判定是否支持/包含轨迹数据（依据配置文件中的里程与心率阈值，二者为“或”关系）：
	// 低于配置阈值的记录仅作为统计汇总，不暴露几何坐标，保护日常住址起终点隐私
	hasTrack := cfg.ShouldGenerateTrack(actType, distanceKm, avgHR)

	var startCoord [2]float64
	var endCoord [2]float64
	var bbox BoundingBox
	var simplifiedCoords [][]float64
	var detailCoordinates [][]float64
	var profile []ProfilePoint
	var detailFile string

	if hasTrack {
		// 离线经纬度起点与终点
		startCoord = [2]float64{rawPoints[0].Lon, rawPoints[0].Lat}
		endCoord = [2]float64{rawPoints[len(rawPoints)-1].Lon, rawPoints[len(rawPoints)-1].Lat}
		bbox = CalculateBoundingBox(rawPoints)

		// Douglas-Peucker 抽稀优化
		// 针对全景底图（容差 8 米）
		simplifiedMapPoints := DouglasPeucker(rawPoints, 8.0)
		simplifiedCoords = make([][]float64, len(simplifiedMapPoints))
		for i, sp := range simplifiedMapPoints {
			simplifiedCoords[i] = []float64{roundCoord(sp.Lon), roundCoord(sp.Lat)}
		}

		// 针对详细单轨迹（容差 3 米），大幅降低数据量并保持极高几何保真度
		simplifiedDetailPoints := DouglasPeucker(rawPoints, 3.0)
		detailCoordinates = make([][]float64, len(simplifiedDetailPoints))
		for i, sp := range simplifiedDetailPoints {
			timeUnix := sp.Time.Unix()
			if sp.Time.IsZero() {
				timeUnix = 0
			}
			detailCoordinates[i] = []float64{
				roundCoord(sp.Lon),
				roundCoord(sp.Lat),
				math.Round(sp.Elevation*10) / 10,
				float64(timeUnix),
				float64(sp.HeartRate),
			}
		}

		// 生成精简高程剖面 Profile (约 80~100 点)
		profile = generateElevationProfile(simplifiedDetailPoints, totalDistance, actType)
		detailFile = fmt.Sprintf("data/tracks/%s.json", id)
	}

	detail := &TrackDetail{
		ID:             id,
		Title:          trackName,
		ActivityType:   actType,
		Country:        country,
		Province:       province,
		City:           city,
		StartTime:      startTime.Format(time.RFC3339),
		DistanceKm:     math.Round(distanceKm*100) / 100,
		ElevationGainM: math.Round(totalElevationGain),
		ElevationLossM: math.Round(totalElevationLoss),
		DurationS:      durationSeconds,
		AvgSpeedKmh:    math.Round(avgSpeedKmh*10) / 10,
		MaxElevationM:  math.Round(maxEle),
		MinElevationM:  math.Round(minEle),
		AvgHeartRate:   avgHR,
		MaxHeartRate:   maxHR,
		BoundingBox:    bbox,
		HasTrack:       hasTrack,
		Coordinates:    detailCoordinates,
		Profile:        profile,
	}

	manifestItem := &TrackManifestItem{
		ID:             id,
		Title:          trackName,
		ActivityType:   actType,
		Country:        country,
		Province:       province,
		City:           city,
		StartTime:      startTime.Format(time.RFC3339),
		Year:           startTime.Year(),
		DistanceKm:     math.Round(distanceKm*100) / 100,
		ElevationGainM: math.Round(totalElevationGain),
		ElevationLossM: math.Round(totalElevationLoss),
		DurationS:      durationSeconds,
		AvgSpeedKmh:    math.Round(avgSpeedKmh*10) / 10,
		MaxElevationM:  math.Round(maxEle),
		MinElevationM:  math.Round(minEle),
		AvgHeartRate:   avgHR,
		MaxHeartRate:   maxHR,
		BoundingBox:    bbox,
		StartCoord:     startCoord,
		EndCoord:       endCoord,
		DetailFile:     detailFile,
		HasTrack:       hasTrack,
	}

	// 5. 应用人工校准覆盖 (Override)
	if cfg != nil {
		if ov, exists := cfg.GetOverride(id, baseName); exists {
			if ov.DistanceKm != nil {
				oldDist := detail.DistanceKm
				detail.DistanceKm = math.Round(*ov.DistanceKm*100) / 100
				manifestItem.DistanceKm = detail.DistanceKm
				if detail.DurationS > 0 {
					detail.AvgSpeedKmh = math.Round((detail.DistanceKm/(float64(detail.DurationS)/3600.0))*10) / 10
					manifestItem.AvgSpeedKmh = detail.AvgSpeedKmh
				}
				if oldDist > 0 && len(detail.Profile) > 0 {
					scaleRatio := *ov.DistanceKm / oldDist
					for pIdx := range detail.Profile {
						detail.Profile[pIdx].DistanceKm = math.Round(detail.Profile[pIdx].DistanceKm*scaleRatio*100) / 100
					}
				}
			}
			if ov.ElevationGainM != nil {
				detail.ElevationGainM = math.Round(*ov.ElevationGainM)
				manifestItem.ElevationGainM = detail.ElevationGainM
			}
			if ov.ElevationLossM != nil {
				detail.ElevationLossM = math.Round(*ov.ElevationLossM)
				manifestItem.ElevationLossM = detail.ElevationLossM
			}
			if ov.Title != nil && *ov.Title != "" {
				detail.Title = *ov.Title
				manifestItem.Title = *ov.Title
			}
			if ov.Type != nil && *ov.Type != "" {
				detail.ActivityType = *ov.Type
				manifestItem.ActivityType = *ov.Type
			}
		}
	}

	return detail, manifestItem, simplifiedCoords, nil
}

func convertPoint(pt gpxPoint) RawPoint {
	t, _ := parseFlexibleTime(pt.Time)
	hr := 0
	if pt.InnerXML != "" {
		if m := hrRegex.FindStringSubmatch(pt.InnerXML); len(m) > 1 {
			if v, err := strconv.Atoi(m[1]); err == nil {
				hr = v
			}
		}
	}
	return RawPoint{
		Lat:       pt.Lat,
		Lon:       pt.Lon,
		Elevation: pt.Ele,
		Time:      t,
		Speed:     pt.Speed,
		HeartRate: hr,
	}
}

// 智能判定运动类型（结合速度、地形爬升、海拔落差、坡度与逆地理空间属性）
func resolveActivityType(fileName, gpxType string, avgSpeedKmh, elevationGainM, distanceKm, eleSpan, maxEle float64, loc *geocoding.LocationInfo) ActivityType {
	lowerName := strings.ToLower(fileName)
	lowerType := strings.ToLower(gpxType)

	// 1. 显式关键字匹配
	if strings.Contains(lowerName, "flight") || strings.Contains(lowerName, "plane") || strings.Contains(lowerName, "airplane") || strings.Contains(lowerName, "飞机") || strings.Contains(lowerName, "飞行") || strings.Contains(lowerName, "航线") || strings.Contains(lowerType, "flight") {
		return TypeFlight
	}
	if strings.Contains(lowerName, "trail") || strings.Contains(lowerName, "越野") || strings.Contains(lowerType, "trail") {
		return TypeTrailRunning
	}
	if strings.Contains(lowerName, "hike") || strings.Contains(lowerName, "hiking") || strings.Contains(lowerName, "徒步") || strings.Contains(lowerName, "登山") || strings.Contains(lowerType, "hiking") {
		return TypeHiking
	}
	if strings.Contains(lowerName, "bike") || strings.Contains(lowerName, "cycling") || strings.Contains(lowerName, "ride") || strings.Contains(lowerName, "骑行") || strings.Contains(lowerType, "cycling") {
		return TypeCycling
	}
	if strings.Contains(lowerName, "drive") || strings.Contains(lowerName, "driving") || strings.Contains(lowerName, "驾车") || strings.Contains(lowerName, "自驾") || strings.Contains(lowerType, "driving") {
		return TypeDriving
	}
	if strings.Contains(lowerName, "train") || strings.Contains(lowerName, "railway") || strings.Contains(lowerName, "transit") || strings.Contains(lowerName, "火车") || strings.Contains(lowerName, "高铁") || strings.Contains(lowerName, "动车") || strings.Contains(lowerName, "铁路") {
		return TypeTrain
	}
	if strings.Contains(lowerName, "walk") || strings.Contains(lowerName, "walking") || strings.Contains(lowerName, "行走") || strings.Contains(lowerName, "散步") {
		return TypeWalking
	}
	if strings.Contains(lowerName, "skate") || strings.Contains(lowerName, "skateboarding") || strings.Contains(lowerName, "滑板") {
		return TypeSkateboarding
	}
	if strings.Contains(lowerName, "run") || strings.Contains(lowerName, "running") || strings.Contains(lowerName, "跑步") || strings.Contains(lowerType, "running") {
		// 跑步根据爬升率与真实落差微调是否为越野跑
		if distanceKm > 0 && (elevationGainM/distanceKm) > 30.0 && eleSpan >= 80.0 {
			return TypeTrailRunning
		}
		return TypeRunning
	}

	// 2. 特征推测
	if avgSpeedKmh > 350.0 && maxEle > 2000.0 {
		return TypeFlight
	}
	if avgSpeedKmh > 55.0 {
		return TypeDriving
	}
	if avgSpeedKmh >= 15.0 && avgSpeedKmh <= 50.0 {
		return TypeCycling
	}

	// 3. 速度 < 6.0 km/h（步行/散步/徒步区间）或 6.0~15.0 km/h（路跑/越野跑区间）：结合城市/城镇地理空间特征判定
	isUrban := false
	if loc != nil {
		// FeatureClass "P" 为城镇居民点(Populated Place), "A" 为行政区域
		// FeatureClass "T" 为山地山峰, "L" 为风景自然保护区
		if (loc.FeatureClass == "P" || loc.FeatureClass == "A") && loc.DistanceKm <= 5.0 {
			isUrban = true
		} else if loc.City != "" && loc.FeatureClass != "T" && loc.DistanceKm <= 5.0 {
			isUrban = true
		}
	}

	// 奔跑区间 (6.0 ~ 15.0 km/h)
	if avgSpeedKmh >= 6.0 && avgSpeedKmh < 15.0 {
		if isUrban {
			// 城市生活区跑步（路跑/夜跑/绿道跑）：
			// 仅当具有显著山体落差(eleSpan >= 120m)与高爬升时才归类为城市越野跑
			if eleSpan >= 120.0 && elevationGainM >= 250.0 && (distanceKm > 0 && (elevationGainM/distanceKm) >= 35.0) {
				return TypeTrailRunning
			}
			return TypeRunning
		}
		// 野外/山区环境
		if eleSpan >= 80.0 && (distanceKm > 0 && (elevationGainM/distanceKm) > 30.0) {
			return TypeTrailRunning
		}
		return TypeRunning
	}

	if isUrban {
		// 城市生活区散步/漫步（过滤由于气压高程漂移、过街天桥或平缓坡度带来的累计爬升）
		// 仅当真实落差显著(eleSpan >= 120m)且爬升明显(>=250m)且坡度大(>=35m/km)（如城市山体公园爬山）时才归类为 hiking
		if eleSpan >= 120.0 && elevationGainM >= 250.0 && (distanceKm > 0 && (elevationGainM/distanceKm) >= 35.0) {
			return TypeHiking
		}
		return TypeWalking
	}

	// 野外/山区/荒野环境（需具备一定海拔落差或爬升坡度，平缓漫步归为 Walking）
	if (elevationGainM > 180.0 || (distanceKm > 0 && (elevationGainM/distanceKm) > 25.0)) && eleSpan >= 80.0 {
		return TypeHiking
	}
	return TypeWalking
}

func generateElevationProfile(points []RawPoint, totalDist float64, actType ActivityType) []ProfilePoint {
	if len(points) == 0 {
		return nil
	}
	var profile []ProfilePoint
	var runningDist float64

	// 1. 先计算 points 在经过速度过滤后的实际可达总里程
	var totalValidDist float64
	for i := 1; i < len(points); i++ {
		prev := points[i-1]
		curr := points[i]
		d := HaversineDistance(prev.Lat, prev.Lon, curr.Lat, curr.Lon)
		if !curr.Time.IsZero() && !prev.Time.IsZero() {
			dt := curr.Time.Sub(prev.Time).Seconds()
			if dt > 0 {
				speedKmh := (d / dt) * 3.6
				if (actType == TypeWalking || actType == TypeHiking) && speedKmh > 15.0 {
					continue
				}
				if actType == TypeRunning && speedKmh > 25.0 {
					continue
				}
			}
		}
		totalValidDist += d
	}

	targetSamples := 80
	stepDist := totalValidDist / float64(targetSamples)
	if stepDist <= 0 {
		stepDist = 100.0
	}

	profile = append(profile, ProfilePoint{
		DistanceKm: 0,
		Elevation:  math.Round(points[0].Elevation*10) / 10,
		HeartRate:  points[0].HeartRate,
		Index:      0,
	})

	// 比例缩放因子：确保 profile 最后一个点的 DistanceKm 严格对齐 totalDist
	scaleRatio := 1.0
	if totalValidDist > 0 && totalDist > 0 {
		scaleRatio = totalDist / totalValidDist
	}

	nextSampleDist := stepDist
	for i := 1; i < len(points); i++ {
		prev := points[i-1]
		curr := points[i]
		d := HaversineDistance(prev.Lat, prev.Lon, curr.Lat, curr.Lon)
		if !curr.Time.IsZero() && !prev.Time.IsZero() {
			dt := curr.Time.Sub(prev.Time).Seconds()
			if dt > 0 {
				speedKmh := (d / dt) * 3.6
				if (actType == TypeWalking || actType == TypeHiking) && speedKmh > 15.0 {
					continue
				}
				if actType == TypeRunning && speedKmh > 25.0 {
					continue
				}
			}
		}
		runningDist += d

		if runningDist >= nextSampleDist || i == len(points)-1 {
			scaledDistKm := (runningDist * scaleRatio) / 1000.0
			profile = append(profile, ProfilePoint{
				DistanceKm: math.Round(scaledDistKm*100) / 100,
				Elevation:  math.Round(curr.Elevation*10) / 10,
				HeartRate:  curr.HeartRate,
				Index:      i,
			})
			nextSampleDist += stepDist
		}
	}

	return profile
}

func cleanFilenameTitle(s string) string {
	s = strings.ReplaceAll(s, "_", " ")
	s = strings.ReplaceAll(s, "-", " ")
	return strings.TrimSpace(s)
}

func extractDateFromText(s string) (time.Time, error) {
	// 尝试匹配 20260207 或 2026-05-16
	for i := 0; i+8 <= len(s); i++ {
		sub := s[i : i+8]
		if t, err := time.Parse("20060102", sub); err == nil {
			return t, nil
		}
	}
	for i := 0; i+10 <= len(s); i++ {
		sub := s[i : i+10]
		if t, err := time.Parse("2006-01-02", sub); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("no date in filename")
}

func roundCoord(v float64) float64 {
	return math.Round(v*1000000) / 1000000
}

// StandardFilenameInfo 规范化文件名拆解数据
type StandardFilenameInfo struct {
	ActivityType ActivityType
	Country      string
	Province     string
	Title        string
	Date         time.Time
	HasDate      bool
}

// ParseStandardFilename 尝试按照 {运动类型}-{国家}-{省份}-{路线/地点名称}-{YYYYMMDD} 拆解标准文件名
func ParseStandardFilename(baseName string) (*StandardFilenameInfo, bool) {
	parts := strings.Split(baseName, "-")
	if len(parts) >= 5 {
		// 1. 第 0 段：运动类型 (如 hiking / 徒步 / driving)
		actType := normalizeActivityType(parts[0])
		if actType == "" {
			return nil, false
		}

		country := strings.TrimSpace(parts[1])
		province := strings.TrimSpace(parts[2])

		// 2. 最后一段：日期 (YYYYMMDD 或 YYYY_MM_DD)
		lastPart := parts[len(parts)-1]
		var dateVal time.Time
		hasDate := false
		if t, err := extractDateFromText(lastPart); err == nil {
			dateVal = t
			hasDate = true
		}

		// 3. 中间所有段作为标题（支持路线名本身包含短横线或下划线）
		titleParts := parts[3 : len(parts)-1]
		title := strings.Join(titleParts, "-")
		title = strings.ReplaceAll(title, "_", " ")
		title = strings.TrimSpace(title)

		if title == "" {
			title = fmt.Sprintf("%s %s", province, actType)
		}

		return &StandardFilenameInfo{
			ActivityType: actType,
			Country:      country,
			Province:     province,
			Title:        title,
			Date:         dateVal,
			HasDate:      hasDate,
		}, true
	}

	return nil, false
}

// normalizeActivityType 将中英文运动类型字符串规范化为标准 ActivityType
func normalizeActivityType(s string) ActivityType {
	lower := strings.ToLower(strings.TrimSpace(s))
	switch lower {
	case "flight", "fly", "plane", "airplane", "aviation", "飞机", "飞行", "航线", "航班":
		return TypeFlight
	case "train", "railway", "rail", "transit", "火车", "高铁", "动车", "铁路", "旅行", "交通":
		return TypeTrain
	case "hiking", "hike", "徒步", "登山", "穿越", "古道":
		return TypeHiking
	case "trail_running", "trail", "trailrunning", "越野跑", "越野":
		return TypeTrailRunning
	case "cycling", "cycle", "bike", "ride", "骑行", "单车", "公路车":
		return TypeCycling
	case "running", "run", "跑步", "路跑", "半马", "全马", "马拉松":
		return TypeRunning
	case "walking", "walk", "行走", "散步", "健步":
		return TypeWalking
	case "skateboarding", "skate", "滑板", "陆冲", "长板":
		return TypeSkateboarding
	case "driving", "drive", "car", "驾车", "自驾", "自驾游", "巡游", "车游", "公路":
		return TypeDriving
	default:
		// 模糊包含匹配
		if strings.Contains(lower, "flight") || strings.Contains(lower, "fly") || strings.Contains(lower, "飞") || strings.Contains(lower, "航") {
			return TypeFlight
		}
		if strings.Contains(lower, "train") || strings.Contains(lower, "铁") || strings.Contains(lower, "火车") {
			return TypeTrain
		}
		if strings.Contains(lower, "trail") || strings.Contains(lower, "越野") {
			return TypeTrailRunning
		}
		if strings.Contains(lower, "hike") || strings.Contains(lower, "徒步") || strings.Contains(lower, "登山") {
			return TypeHiking
		}
		if strings.Contains(lower, "bike") || strings.Contains(lower, "cycl") || strings.Contains(lower, "骑") {
			return TypeCycling
		}
		if strings.Contains(lower, "driv") || strings.Contains(lower, "驾") {
			return TypeDriving
		}
		if strings.Contains(lower, "run") || strings.Contains(lower, "跑") {
			return TypeRunning
		}
		if strings.Contains(lower, "walk") || strings.Contains(lower, "步") || strings.Contains(lower, "行") {
			return TypeWalking
		}
		if strings.Contains(lower, "skate") || strings.Contains(lower, "滑板") {
			return TypeSkateboarding
		}
		return ""
	}
}
