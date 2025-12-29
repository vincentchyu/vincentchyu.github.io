package photo

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"github.com/dsoprea/go-exif/v3"
)

// ExifExtractor 定义 EXIF 提取接口
type ExifExtractor interface {
	// Extract 从图片文件中提取 EXIF 数据
	// 返回: EXIF 数据映射, 宽度, 高度, 拍摄时间, 错误
	Extract(filePath string) (map[string]interface{}, int, int, time.Time, error)
}

// ExifExtractorType 定义提取器类型
type ExifExtractorType string

const (
	ExifExtractorGoExif   ExifExtractorType = "go-exif"  // 使用 go-exif 库
	ExifExtractorExifTool ExifExtractorType = "exiftool" // 使用 exiftool 命令
)

// 全局配置:选择使用哪种 EXIF 提取器
var (
	CurrentExifExtractor = ExifExtractorExifTool // 默认使用 exiftool
)

// GoExifExtractor 使用 go-exif 库实现的提取器
type GoExifExtractor struct{}

// Extract 实现 ExifExtractor 接口
func (e *GoExifExtractor) Extract(filePath string) (map[string]interface{}, int, int, time.Time, error) {
	return extractExifNative(filePath)
}

// ExifToolExtractor 使用 exiftool 命令实现的提取器
type ExifToolExtractor struct{}

// Extract 实现 ExifExtractor 接口
func (e *ExifToolExtractor) Extract(filePath string) (map[string]interface{}, int, int, time.Time, error) {
	return extractExifWithTool(filePath)
}

// GetExifExtractor 根据配置返回对应的提取器
func GetExifExtractor() ExifExtractor {
	switch CurrentExifExtractor {
	case ExifExtractorExifTool:
		return &ExifToolExtractor{}
	default:
		return &GoExifExtractor{}
	}
}

// extractExifNative uses go-exif to extract EXIF data
func extractExifNative(filePath string) (map[string]interface{}, int, int, time.Time, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, 0, 0, time.Time{}, err
	}
	defer func(f *os.File) {
		err := f.Close()
		if err != nil {
			log.Println("Failed to close file.")
		}
	}(f)

	// Read first chunk of file to find EXIF
	rawExif, err := exif.SearchAndExtractExifWithReader(f)
	if err != nil {
		return nil, 0, 0, time.Time{}, err
	}

	// Use GetFlatExifData to get all tags
	entries, _, err := exif.GetFlatExifData(rawExif, nil)
	if err != nil {
		return nil, 0, 0, time.Time{}, err
	}

	exifData := make(map[string]interface{})
	var width, height int
	var dateTaken time.Time

	for _, entry := range entries {
		// fmt.Printf("Debug Tag: ID=0x%04x Name=%s Value=%v\n", entry.TagId, entry.TagName, entry.Value)
		exifData[entry.TagName] = entry.Formatted

		// Handle specific fields
		switch entry.TagName {
		case "DateTimeOriginal":
			if dateStr, ok := entry.Value.(string); ok {
				// Format: "2006:01:02 15:04:05"
				dateTaken, _ = time.Parse("2006:01:02 15:04:05", dateStr)
				exifData["DateTimeOriginal"] = dateStr
			} else {
				exifData["DateTimeOriginal"] = entry.Formatted
				dateTaken, _ = time.Parse("2006:01:02 15:04:05", entry.Formatted)
			}
		case "PixelXDimension":
			if v, ok := entry.Value.([]uint32); ok && len(v) > 0 {
				width = int(v[0])
			} else if v, ok := entry.Value.([]int64); ok && len(v) > 0 {
				width = int(v[0])
			} else if v, ok := entry.Value.([]int); ok && len(v) > 0 {
				width = int(v[0])
			}
		case "PixelYDimension":
			if v, ok := entry.Value.([]uint32); ok && len(v) > 0 {
				height = int(v[0])
			} else if v, ok := entry.Value.([]int64); ok && len(v) > 0 {
				height = int(v[0])
			} else if v, ok := entry.Value.([]int); ok && len(v) > 0 {
				height = int(v[0])
			}
		case "GPSLatitude":
			exifData["GPSLatitude"] = entry.Formatted
		case "GPSLongitude":
			exifData["GPSLongitude"] = entry.Formatted
		// Windows XP Tags
		case "XPKeywords": // 0x9c9e
			if bytes, ok := entry.Value.([]byte); ok {
				exifData["XPKeywords"] = decodeUCS2(bytes)
			}
		case "XPSubject": // 0x9c9f
			if bytes, ok := entry.Value.([]byte); ok {
				exifData["XPSubject"] = decodeUCS2(bytes)
			}
		case "XPTitle": // 0x9c9c
			if bytes, ok := entry.Value.([]byte); ok {
				exifData["XPTitle"] = decodeUCS2(bytes)
			}
		case "XPComment": // 0x9c9c
			if bytes, ok := entry.Value.([]byte); ok {
				exifData["XPComment"] = decodeUCS2(bytes)
			}
		case "XPAuthor": // 0x9c9d
			if bytes, ok := entry.Value.([]byte); ok {
				exifData["XPAuthor"] = decodeUCS2(bytes)
			}
		}
	}

	// Normalize EXIF data
	exifData = normalizeExif(exifData)

	return exifData, width, height, dateTaken, nil
}

// extractExifWithTool uses exiftool command to extract EXIF data
func extractExifWithTool(filePath string) (map[string]interface{}, int, int, time.Time, error) {
	// 执行 exiftool -json 命令
	cmd := exec.Command("exiftool", "-json", "-charset", "utf8", filePath)
	output, err := cmd.Output()
	if err != nil {
		return nil, 0, 0, time.Time{}, fmt.Errorf("exiftool command failed: %w", err)
	}

	// 解析 JSON 输出
	var results []map[string]interface{}
	if err := json.Unmarshal(output, &results); err != nil {
		return nil, 0, 0, time.Time{}, fmt.Errorf("failed to parse exiftool output: %w", err)
	}

	if len(results) == 0 {
		return nil, 0, 0, time.Time{}, fmt.Errorf("no EXIF data found")
	}

	rawExifData := results[0]

	// 提取宽度和高度
	var width, height int
	if w, ok := rawExifData["ImageWidth"].(float64); ok {
		width = int(w)
	}
	if h, ok := rawExifData["ImageHeight"].(float64); ok {
		height = int(h)
	}

	// 提取拍摄时间
	var dateTaken time.Time
	if dateStr, ok := rawExifData["DateTimeOriginal"].(string); ok {
		// exiftool 格式: "2025:11:09 22:05:34"
		dateTaken, _ = time.Parse("2006:01:02 15:04:05", dateStr)
	} else if dateStr, ok := rawExifData["CreateDate"].(string); ok {
		dateTaken, _ = time.Parse("2006:01:02 15:04:05", dateStr)
	}

	// 定义需要保留的字段白名单
	allowedFields := map[string]bool{
		"Aperture":                true,
		"CreateDate":              true,
		"DateTimeOriginal":        true,
		"ExposureMode":            true,
		"ExposureProgram":         true,
		"ExposureTime":            true,
		"FNumber":                 true,
		"Flash":                   true,
		"FocalLength":             true,
		"FocalLengthIn35mmFormat": true,
		"ISO":                     true,
		"Keywords":                true,
		"Lens":                    true,
		"LensModel":               true,
		"Make":                    true,
		"MeteringMode":            true,
		"Model":                   true,
		"OffsetTime":              true,
		"OffsetTimeOriginal":      true,
		"Rating":                  true,
		"SceneCaptureType":        true,
		"ShutterSpeed":            true,
		"Subject":                 true,
		"WhiteBalance":            true,
		"GPSAltitude":             true,
		"GPSLatitude":             true,
		"GPSLatitudeRef":          true,
		"GPSLongitude":            true,
		"GPSLongitudeRef":         true,
	}

	// 过滤字段,只保留白名单中的字段
	filteredExifData := make(map[string]interface{})
	for key, value := range rawExifData {
		if allowedFields[key] {
			filteredExifData[key] = value
		}
	}

	return filteredExifData, width, height, dateTaken, nil
}

// decodeUCS2 decodes a UCS-2 (UTF-16LE) byte slice to a UTF-8 string
// Windows XP tags are stored as UCS-2, null-terminated.
func decodeUCS2(b []byte) string {
	// Remove trailing null bytes (usually 2 bytes)
	for len(b) > 0 && b[len(b)-1] == 0 {
		b = b[:len(b)-1]
	}

	if len(b)%2 != 0 {
		return "" // Invalid length for UCS-2
	}

	runes := make([]rune, len(b)/2)
	for i := 0; i < len(b); i += 2 {
		// Little Endian
		runes[i/2] = rune(uint16(b[i]) | uint16(b[i+1])<<8)
	}
	return string(runes)
}

// normalizeExif transforms raw go-exif data to legacy format
func normalizeExif(raw map[string]interface{}) map[string]interface{} {
	normalized := make(map[string]interface{})

	// Helper to get string value
	getString := func(key string) string {
		if v, ok := raw[key]; ok {
			return fmt.Sprintf("%v", v)
		}
		return ""
	}

	// Helper to get int value from "[n]" string
	getInt := func(key string) (int, bool) {
		s := getString(key)
		s = strings.Trim(s, "[]")
		if i, err := strconv.Atoi(s); err == nil {
			return i, true
		}
		return 0, false
	}

	// 1. Aperture & FNumber
	if val := getString("FNumber"); val != "" {
		if f, err := parseRational(val); err == nil {
			normalized["FNumber"] = f
			normalized["Aperture"] = f
		}
	}

	// 2. ExposureTime & ShutterSpeed
	if val := getString("ExposureTime"); val != "" {
		normalized["ExposureTime"] = formatExposure(val)
		normalized["ShutterSpeed"] = formatExposure(val)
	}

	// 3. FocalLength
	if val := getString("FocalLength"); val != "" {
		if f, err := parseRational(val); err == nil {
			s := fmt.Sprintf("%.1f mm", f)
			normalized["FocalLength"] = s
			normalized["FocalLengthIn35mmFormat"] = strings.Replace(s, ".0 mm", " mm", 1)
		}
	}
	// Override FocalLengthIn35mmFormat if available directly
	if val := getString("FocalLengthIn35mmFilm"); val != "" {
		if f, err := parseRational(val); err == nil {
			s := fmt.Sprintf("%.0f mm", f)
			normalized["FocalLengthIn35mmFormat"] = s
		}
	}

	// 4. ISO
	if val := getString("ISOSpeedRatings"); val != "" {
		// Format: "[320]"
		val = strings.Trim(val, "[]")
		if i, err := strconv.Atoi(val); err == nil {
			normalized["ISO"] = i
		}
	} else if val := getString("RecommendedExposureIndex"); val != "" {
		val = strings.Trim(val, "[]")
		if i, err := strconv.Atoi(val); err == nil {
			normalized["ISO"] = i
		}
	}

	// 5. Lens
	if val := getString("LensModel"); val != "" {
		normalized["LensModel"] = val
		normalized["Lens"] = val
	}

	// 6. Model & Make
	if val := getString("Model"); val != "" {
		normalized["Model"] = val
	}
	if val := getString("Make"); val != "" {
		normalized["Make"] = val
	}

	// 7. DateTime
	if val := getString("DateTimeOriginal"); val != "" {
		normalized["DateTimeOriginal"] = val
		normalized["CreateDate"] = val
	}

	// 8. GPS
	if lat := getString("GPSLatitude"); lat != "" {
		ref := getString("GPSLatitudeRef")
		if formatted, err := formatGPS(lat, ref); err == nil {
			normalized["GPSLatitude"] = formatted
			// Legacy format included Ref in the string: "30 deg 33' 44.70\" N"
			// And also had separate Ref field
			normalized["GPSLatitudeRef"] = mapGPSRef(ref)
		}
	}
	if lon := getString("GPSLongitude"); lon != "" {
		ref := getString("GPSLongitudeRef")
		if formatted, err := formatGPS(lon, ref); err == nil {
			normalized["GPSLongitude"] = formatted
			normalized["GPSLongitudeRef"] = mapGPSRef(ref)
		}
	}
	if alt := getString("GPSAltitude"); alt != "" {
		ref := getString("GPSAltitudeRef") // 0 = Above Sea Level, 1 = Below
		if val, err := parseRational(alt); err == nil {
			suffix := "Above Sea Level"
			if ref == "1" || ref == "01" { // Check raw value
				suffix = "Below Sea Level"
			}
			normalized["GPSAltitude"] = fmt.Sprintf("%.1f m %s", val, suffix)
		}
	}

	// 9. Enums mappings
	if i, ok := getInt("ExposureMode"); ok {
		// 0: Auto, 1: Manual, 2: Auto Bracket
		switch i {
		case 0:
			normalized["ExposureMode"] = "Auto"
		case 1:
			normalized["ExposureMode"] = "Manual"
		case 2:
			normalized["ExposureMode"] = "Auto Bracket"
		default:
			normalized["ExposureMode"] = getString("ExposureMode")
		}
	}

	if i, ok := getInt("ExposureProgram"); ok {
		// 0: Not Defined, 1: Manual, 2: Normal Program, 3: Aperture-priority AE, 4: Shutter speed priority AE
		// 5: Creative (Slow speed), 6: Action (High speed), 7: Portrait, 8: Landscape
		switch i {
		case 1:
			normalized["ExposureProgram"] = "Manual"
		case 2:
			normalized["ExposureProgram"] = "Normal program"
		case 3:
			normalized["ExposureProgram"] = "Aperture-priority AE"
		case 4:
			normalized["ExposureProgram"] = "Shutter speed priority AE"
		case 5:
			normalized["ExposureProgram"] = "Creative program"
		case 6:
			normalized["ExposureProgram"] = "Action program"
		case 7:
			normalized["ExposureProgram"] = "Portrait mode"
		case 8:
			normalized["ExposureProgram"] = "Landscape mode"
		default:
			normalized["ExposureProgram"] = getString("ExposureProgram")
		}
	}

	if i, ok := getInt("MeteringMode"); ok {
		// 0: Unknown, 1: Average, 2: Center-weighted average, 3: Spot, 4: Multi-spot, 5: Multi-segment (Pattern), 6: Partial
		switch i {
		case 1:
			normalized["MeteringMode"] = "Average"
		case 2:
			normalized["MeteringMode"] = "Center-weighted average"
		case 3:
			normalized["MeteringMode"] = "Spot"
		case 4:
			normalized["MeteringMode"] = "Multi-spot"
		case 5:
			normalized["MeteringMode"] = "Multi-segment"
		case 6:
			normalized["MeteringMode"] = "Partial"
		default:
			normalized["MeteringMode"] = getString("MeteringMode")
		}
	}

	if i, ok := getInt("Flash"); ok {
		// Bitmask. 0 = No Flash.
		if i == 0 {
			normalized["Flash"] = "No Flash"
		} else {
			// Simplified mapping for common cases
			if i&1 == 1 {
				normalized["Flash"] = "Fired"
			} else {
				normalized["Flash"] = "Off, Did not fire"
			}
		}
	}

	if i, ok := getInt("WhiteBalance"); ok {
		// 0: Auto, 1: Manual
		switch i {
		case 0:
			normalized["WhiteBalance"] = "Auto"
		case 1:
			normalized["WhiteBalance"] = "Manual"
		default:
			normalized["WhiteBalance"] = getString("WhiteBalance")
		}
	}

	if i, ok := getInt("SceneCaptureType"); ok {
		// 0: Standard, 1: Landscape, 2: Portrait, 3: Night Scene
		switch i {
		case 0:
			normalized["SceneCaptureType"] = "Standard"
		case 1:
			normalized["SceneCaptureType"] = "Landscape"
		case 2:
			normalized["SceneCaptureType"] = "Portrait"
		case 3:
			normalized["SceneCaptureType"] = "Night Scene"
		default:
			normalized["SceneCaptureType"] = getString("SceneCaptureType")
		}
	}

	// Pass through others if needed or requested
	if val := getString("Software"); val != "" {
		normalized["Software"] = val
	}
	if val := getString("Artist"); val != "" {
		normalized["Artist"] = val
	}
	if val := getString("Copyright"); val != "" {
		normalized["Copyright"] = val
	}

	// Windows XP Tags Mapping
	if val := getString("XPKeywords"); val != "" {
		normalized["Keywords"] = val
	}
	if val := getString("XPSubject"); val != "" {
		normalized["Subject"] = val
	}
	if val := getString("XPTitle"); val != "" {
		normalized["Title"] = val
	}
	if val := getString("XPComment"); val != "" {
		normalized["Comment"] = val
	}

	return normalized
}

// parseRational parses "[n/d]" or "[n]" string to float64
func parseRational(s string) (float64, error) {
	s = strings.Trim(s, "[]")
	parts := strings.Split(s, "/")
	if len(parts) == 2 {
		n, err1 := strconv.ParseFloat(parts[0], 64)
		d, err2 := strconv.ParseFloat(parts[1], 64)
		if err1 == nil && err2 == nil && d != 0 {
			return n / d, nil
		}
	} else if len(parts) == 1 {
		return strconv.ParseFloat(parts[0], 64)
	}
	return 0, fmt.Errorf("invalid rational: %s", s)
}

// formatExposure formats exposure time (e.g. "1/200")
func formatExposure(s string) string {
	// Input: "[1/50]" or "[10/300]"
	s = strings.Trim(s, "[]")
	parts := strings.Split(s, "/")
	if len(parts) == 2 {
		n, _ := strconv.ParseFloat(parts[0], 64)
		d, _ := strconv.ParseFloat(parts[1], 64)
		if n == 1 {
			return fmt.Sprintf("1/%.0f", d)
		}
		if n > 0 && d > 0 {
			val := n / d
			if val >= 1 {
				return fmt.Sprintf("%.1f", val) // e.g. 1.5
			}
			// Try to find common denominator?
			// Simple approach: 1 / (d/n)
			return fmt.Sprintf("1/%.0f", d/n)
		}
	}
	return s
}

// formatGPS formats GPS coordinates to "30 deg 33' 44.70\" N"
func formatGPS(raw, ref string) (string, error) {
	// Raw: "[23/1 7/1 2122/100]"
	raw = strings.Trim(raw, "[]")
	parts := strings.Split(raw, " ")
	if len(parts) != 3 {
		return "", fmt.Errorf("invalid gps format")
	}

	deg, err1 := parseRational(parts[0])
	min, err2 := parseRational(parts[1])
	sec, err3 := parseRational(parts[2])

	if err1 != nil || err2 != nil || err3 != nil {
		return "", fmt.Errorf("error parsing gps components")
	}

	ref = mapGPSRef(ref)

	return fmt.Sprintf("%.0f deg %.0f' %.2f\" %s", deg, min, sec, ref), nil
}

func mapGPSRef(ref string) string {
	switch ref {
	case "N", "S", "E", "W":
		return ref // Already correct
	case "0":
		return "North" // Or undefined? Usually N/S/E/W in EXIF
	case "1":
		return "South"
		// Add more if needed based on raw values
	}
	// Sometimes ref is "N" or "S" directly
	if ref == "North" || ref == "South" || ref == "East" || ref == "West" {
		return ref
	}
	// Map single letters to full names if legacy requires full names?
	// Legacy example: "GPSLatitudeRef": "North"
	// Legacy example: "GPSLatitude": "30 deg ... N" (Wait, legacy example has "N" in string, but "North" in Ref field)
	switch ref {
	case "N":
		return "North"
	case "S":
		return "South"
	case "E":
		return "East"
	case "W":
		return "West"
	}
	return ref
}
