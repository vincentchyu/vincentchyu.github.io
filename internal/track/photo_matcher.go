package track

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// PhotoJSONYear 年份相册 JSON 格式
type PhotoJSONYear struct {
	Year   string            `json:"year"`
	Photos []RawPhotoRecord  `json:"photos"`
}

// RawPhotoRecord 原始照片元数据
type RawPhotoRecord struct {
	Filename  string            `json:"filename"`
	Path      string            `json:"path"`
	Thumbnail string            `json:"thumbnail"`
	Date      string            `json:"date"`
	Width     int               `json:"width"`
	Height    int               `json:"height"`
	Exif      RawPhotoExif      `json:"exif"`
	Hash      string            `json:"hash"`
	IsHidden  bool              `json:"is_hidden"`
}

type RawPhotoExif struct {
	CreateDate       string      `json:"CreateDate"`
	DateTimeOriginal string      `json:"DateTimeOriginal"`
	OffsetTime       string      `json:"OffsetTime"`
	OffsetTimeOrig   string      `json:"OffsetTimeOriginal"`
	Model            string      `json:"Model"`
	Lens             string      `json:"Lens"`
	LensModel        string      `json:"LensModel"`
	FNumber          interface{} `json:"FNumber"`
	ExposureTime     string      `json:"ExposureTime"`
	ISO              interface{} `json:"ISO"`
	FocalLength      string      `json:"FocalLength"`
	GPSLatitude      string      `json:"GPSLatitude"`
	GPSLongitude     string      `json:"GPSLongitude"`
	GPSLatitudeRef   string      `json:"GPSLatitudeRef"`
	GPSLongitudeRef  string      `json:"GPSLongitudeRef"`
}

// PhotoEntry 规范化的摄影照片
type PhotoEntry struct {
	ID        string
	Filename  string
	Thumbnail string
	Original  string
	Time      time.Time
	HasGPS    bool
	Lat       float64
	Lon       float64
	Camera    string
	Lens      string
	Params    string
}

// LoadAllPhotographyPhotos 从 web/photography/data/photos/ 加载全部照片
func LoadAllPhotographyPhotos(photosDir string) ([]PhotoEntry, error) {
	if _, err := os.Stat(photosDir); os.IsNotExist(err) {
		return nil, nil
	}

	files, err := os.ReadDir(photosDir)
	if err != nil {
		return nil, err
	}

	var results []PhotoEntry

	for _, file := range files {
		if file.IsDir() || !strings.HasSuffix(strings.ToLower(file.Name()), ".json") {
			continue
		}

		fullPath := filepath.Join(photosDir, file.Name())
		data, err := os.ReadFile(fullPath)
		if err != nil {
			continue
		}

		var yearData PhotoJSONYear
		if err := json.Unmarshal(data, &yearData); err != nil {
			continue
		}

		for _, p := range yearData.Photos {
			if p.IsHidden {
				continue
			}

			entry := parsePhotoEntry(p)
			if !entry.Time.IsZero() {
				results = append(results, entry)
			}
		}
	}

	return results, nil
}

func parsePhotoEntry(p RawPhotoRecord) PhotoEntry {
	ex := p.Exif
	tStr := ex.DateTimeOriginal
	if tStr == "" {
		tStr = ex.CreateDate
	}

	photoTime := parseExifTime(tStr, ex.OffsetTimeOrig)
	if photoTime.IsZero() && p.Date != "" {
		photoTime, _ = time.Parse("2006-01-02", p.Date)
	}

	hasGPS := false
	lat, lon := 0.0, 0.0
	if ex.GPSLatitude != "" && ex.GPSLongitude != "" {
		lat = parseDMSCoordinate(ex.GPSLatitude, ex.GPSLatitudeRef)
		lon = parseDMSCoordinate(ex.GPSLongitude, ex.GPSLongitudeRef)
		if lat != 0 && lon != 0 {
			hasGPS = true
		}
	}

	lens := ex.LensModel
	if lens == "" {
		lens = ex.Lens
	}

	// 格式化拍摄参数
	var paramsParts []string
	if ex.FocalLength != "" {
		paramsParts = append(paramsParts, ex.FocalLength)
	}
	if ex.FNumber != nil {
		paramsParts = append(paramsParts, fmt.Sprintf("f/%v", ex.FNumber))
	}
	if ex.ExposureTime != "" {
		paramsParts = append(paramsParts, fmt.Sprintf("%ss", ex.ExposureTime))
	}
	if ex.ISO != nil {
		paramsParts = append(paramsParts, fmt.Sprintf("ISO %v", ex.ISO))
	}
	paramStr := strings.Join(paramsParts, " · ")

	id := p.Hash
	if id == "" {
		id = p.Filename
	}

	return PhotoEntry{
		ID:        id,
		Filename:  p.Filename,
		Thumbnail: p.Thumbnail,
		Original:  p.Path,
		Time:      photoTime,
		HasGPS:    hasGPS,
		Lat:       lat,
		Lon:       lon,
		Camera:    ex.Model,
		Lens:      lens,
		Params:    paramStr,
	}
}

// MatchPhotosWithDetail 匹配轨迹详情关联的摄影照片
func MatchPhotosWithDetail(detail *TrackDetail, photos []PhotoEntry) []TrackPhotoItem {
	if len(photos) == 0 || detail == nil || len(detail.Coordinates) == 0 {
		return nil
	}

	trackStart, err := time.Parse(time.RFC3339, detail.StartTime)
	if err != nil {
		return nil
	}
	trackEnd := trackStart.Add(time.Duration(detail.DurationS) * time.Second)

	var matched []TrackPhotoItem

	// 扩大时间窗到前后 1 小时，或者同日且地点重合
	startWindow := trackStart.Add(-60 * time.Minute)
	endWindow := trackEnd.Add(60 * time.Minute)

	for _, p := range photos {
		isTimeMatch := p.Time.After(startWindow) && p.Time.Before(endWindow)
		
		// 若不同时间，但属于同一天（年月日相同）
		isSameDay := p.Time.Year() == trackStart.Year() && p.Time.YearDay() == trackStart.YearDay()

		photoLat, photoLon := p.Lat, p.Lon

		if !isTimeMatch && !isSameDay {
			continue
		}

		if !p.HasGPS {
			if isTimeMatch {
				// 根据时间在轨迹坐标中做线性插值
				photoLat, photoLon = interpolateDetailCoord(detail.Coordinates, p.Time.Unix())
			} else {
				// 同一天但无精准时间匹配且无 GPS 则跳过
				continue
			}
		} else {
			// 照片有 GPS 坐标，检查是否落在轨迹 20km 范围内
			minDist := 999999.0
			for _, coord := range detail.Coordinates {
				d := HaversineDistance(photoLat, photoLon, coord[1], coord[0])
				if d < minDist {
					minDist = d
				}
			}
			if minDist > 20000.0 {
				continue
			}
		}

		matched = append(matched, TrackPhotoItem{
			ID:        p.ID,
			Filename:  p.Filename,
			Thumbnail: p.Thumbnail,
			Original:  p.Original,
			Coord:     [2]float64{roundCoord(photoLon), roundCoord(photoLat)},
			Time:      p.Time.Format("2006-01-02 15:04:05"),
			Camera:    p.Camera,
			Lens:      p.Lens,
			Params:    p.Params,
		})
	}

	return matched
}

func interpolateDetailCoord(coords [][]float64, targetUnix int64) (float64, float64) {
	if len(coords) == 0 {
		return 0, 0
	}
	target := float64(targetUnix)

	for i := 0; i < len(coords)-1; i++ {
		t1 := coords[i][3]
		t2 := coords[i+1][3]
		if t1 <= target && t2 >= target {
			span := t2 - t1
			if span <= 0 {
				return coords[i][1], coords[i][0]
			}
			ratio := (target - t1) / span
			lat := coords[i][1] + (coords[i+1][1]-coords[i][1])*ratio
			lon := coords[i][0] + (coords[i+1][0]-coords[i][0])*ratio
			return lat, lon
		}
	}

	// 找不到精确点，找最接近的时间点
	minDiff := math.MaxFloat64
	bestIdx := 0
	for i, c := range coords {
		diff := math.Abs(c[3] - target)
		if diff < minDiff {
			minDiff = diff
			bestIdx = i
		}
	}
	return coords[bestIdx][1], coords[bestIdx][0]
}

func interpolateTrackCoordinate(points []RawPoint, target time.Time) (float64, float64, bool) {
	if len(points) == 0 {
		return 0, 0, false
	}
	if points[0].Time.IsZero() {
		return points[0].Lat, points[0].Lon, true
	}

	for i := 0; i < len(points)-1; i++ {
		p1 := points[i]
		p2 := points[i+1]
		if (p1.Time.Equal(target) || p1.Time.Before(target)) && (p2.Time.Equal(target) || p2.Time.After(target)) {
			totalSpan := p2.Time.Sub(p1.Time).Seconds()
			if totalSpan <= 0 {
				return p1.Lat, p1.Lon, true
			}
			ratio := target.Sub(p1.Time).Seconds() / totalSpan
			lat := p1.Lat + (p2.Lat-p1.Lat)*ratio
			lon := p1.Lon + (p2.Lon-p1.Lon)*ratio
			return lat, lon, true
		}
	}

	// 距离最近的一个点
	minDiff := math.MaxFloat64
	bestIdx := 0
	for i, pt := range points {
		diff := math.Abs(pt.Time.Sub(target).Seconds())
		if diff < minDiff {
			minDiff = diff
			bestIdx = i
		}
	}
	return points[bestIdx].Lat, points[bestIdx].Lon, true
}

func parseExifTime(dateStr, offsetStr string) time.Time {
	dateStr = strings.TrimSpace(dateStr)
	if dateStr == "" {
		return time.Time{}
	}

	// 标准 EXIF 格式 "2026:06:14 14:23:19"
	dateStr = strings.ReplaceAll(dateStr, "/", ":")
	parts := strings.Split(dateStr, " ")
	if len(parts) == 2 {
		parts[0] = strings.ReplaceAll(parts[0], ":", "-")
		isoStr := parts[0] + "T" + parts[1]
		if offsetStr != "" {
			isoStr += offsetStr
		} else {
			isoStr += "+08:00"
		}
		if t, err := time.Parse(time.RFC3339, isoStr); err == nil {
			return t
		}
	}

	return time.Time{}
}

var dmsRegex = regexp.MustCompile(`([0-9.]+)\s*deg\s*([0-9.]+)?'?\s*([0-9.]+)?\"?`)

func parseDMSCoordinate(dms, ref string) float64 {
	dms = strings.TrimSpace(dms)
	matches := dmsRegex.FindStringSubmatch(dms)
	if len(matches) < 2 {
		if v, err := strconv.ParseFloat(dms, 64); err == nil {
			return v
		}
		return 0
	}

	deg, _ := strconv.ParseFloat(matches[1], 64)
	min := 0.0
	sec := 0.0
	if len(matches) > 2 && matches[2] != "" {
		min, _ = strconv.ParseFloat(matches[2], 64)
	}
	if len(matches) > 3 && matches[3] != "" {
		sec, _ = strconv.ParseFloat(matches[3], 64)
	}

	val := deg + min/60.0 + sec/3600.0
	ref = strings.ToUpper(strings.TrimSpace(ref))
	if ref == "S" || ref == "W" || strings.Contains(dms, "S") || strings.Contains(dms, "W") {
		val = -val
	}
	return val
}
