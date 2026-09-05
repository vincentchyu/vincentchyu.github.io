package track

import (
	"context"
	"fmt"
	"math"
	"strings"
	"sync"

	"github.com/vincentchyu/photools/pkg/geocoding"
)

const earthRadiusMeters = 6371000.0

// DegreesToRadians 角度转弧度
func DegreesToRadians(d float64) float64 {
	return d * math.Pi / 180.0
}

// HaversineDistance 计算两个经纬度坐标之间的球面大圆距离（单位：米）
func HaversineDistance(lat1, lon1, lat2, lon2 float64) float64 {
	dLat := DegreesToRadians(lat2 - lat1)
	dLon := DegreesToRadians(lon2 - lon1)

	lat1Rad := DegreesToRadians(lat1)
	lat2Rad := DegreesToRadians(lat2)

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return earthRadiusMeters * c
}

// PerpendicularDistance 计算点 p 到线段 (a, b) 的投影垂直距离（单位：米）
func PerpendicularDistance(p, a, b RawPoint) float64 {
	lineDist := HaversineDistance(a.Lat, a.Lon, b.Lat, b.Lon)
	if lineDist < 0.001 {
		return HaversineDistance(p.Lat, p.Lon, a.Lat, a.Lon)
	}

	// 局部笛卡尔平面投影简化（适用于数十公里以内的局部线段）
	midLat := (a.Lat + b.Lat + p.Lat) / 3.0
	cosLat := math.Cos(DegreesToRadians(midLat))

	// 将经纬度转为近似米坐标 (x = lon * cos(lat) * scale, y = lat * scale)
	scale := earthRadiusMeters * (math.Pi / 180.0)
	ax, ay := a.Lon*cosLat*scale, a.Lat*scale
	bx, by := b.Lon*cosLat*scale, b.Lat*scale
	px, py := p.Lon*cosLat*scale, p.Lat*scale

	dx := bx - ax
	dy := by - ay

	// 向量叉乘求面积再除以底边长 = 垂直距离
	area := math.Abs(dx*(ay-py) - dy*(ax-px))
	return area / math.Sqrt(dx*dx+dy*dy)
}

// DouglasPeucker 对轨迹点进行抽稀，epsilonMeters 为容差距离（米）
func DouglasPeucker(points []RawPoint, epsilonMeters float64) []RawPoint {
	if len(points) <= 2 {
		return points
	}

	maxDist := 0.0
	index := 0
	lastIdx := len(points) - 1

	for i := 1; i < lastIdx; i++ {
		d := PerpendicularDistance(points[i], points[0], points[lastIdx])
		if d > maxDist {
			maxDist = d
			index = i
		}
	}

	if maxDist > epsilonMeters {
		// 递归抽稀两段
		left := DouglasPeucker(points[:index+1], epsilonMeters)
		right := DouglasPeucker(points[index:], epsilonMeters)

		// 合并结果（去除重复的分割点）
		result := make([]RawPoint, 0, len(left)+len(right)-1)
		result = append(result, left[:len(left)-1]...)
		result = append(result, right...)
		return result
	}

	return []RawPoint{points[0], points[lastIdx]}
}

// SanitizeAndSmoothElevations 对轨迹高程进行清洗与平滑滤波：
// 1. 修复由于 GPS 初始化/未定位造成的 0.0 或异常负值（前向/后向补全）
// 2. 消除传感器瞬时物理不可能跳变
// 3. 采用滑动窗口平滑高频噪点
// 4. 采用 Hysteresis 迟滞算法计算真实爬升 (gain)、下降 (loss)、最低高程 (minEle) 与最高高程 (maxEle)
func SanitizeAndSmoothElevations(points []RawPoint) ([]RawPoint, float64, float64, float64, float64) {
	if len(points) == 0 {
		return points, 0, 0, 0, 0
	}
	if len(points) == 1 {
		return points, 0, 0, points[0].Elevation, points[0].Elevation
	}

	result := make([]RawPoint, len(points))
	copy(result, points)

	// 1. 寻找有效高程（大于 1.0m 且小于 9000m）
	var validEles []float64
	for _, p := range points {
		if p.Elevation > 1.0 && p.Elevation < 9000.0 {
			validEles = append(validEles, p.Elevation)
		}
	}

	// 如果存在有效非零高程，修复前导与中间的 0 值
	if len(validEles) > 0 {
		firstValid := validEles[0]
		currEle := firstValid
		for i := range result {
			if result[i].Elevation <= 1.0 || result[i].Elevation >= 9000.0 {
				result[i].Elevation = currEle
			} else {
				currEle = result[i].Elevation
			}
		}
	}

	// 2. 移动平均平滑（窗口大小 5）
	n := len(result)
	smoothedEles := make([]float64, n)
	w := 5
	for i := 0; i < n; i++ {
		start := i - w/2
		if start < 0 {
			start = 0
		}
		end := i + w/2 + 1
		if end > n {
			end = n
		}
		sum := 0.0
		for j := start; j < end; j++ {
			sum += result[j].Elevation
		}
		smoothedEles[i] = sum / float64(end-start)
	}

	for i := range result {
		result[i].Elevation = smoothedEles[i]
	}

	// 3. 计算 MinEle / MaxEle
	minEle := smoothedEles[0]
	maxEle := smoothedEles[0]
	for _, e := range smoothedEles {
		if e < minEle {
			minEle = e
		}
		if e > maxEle {
			maxEle = e
		}
	}

	// 4. 采用 Hysteresis 迟滞量 (1.5m) 计算真实累计爬升与下降
	threshold := 1.5
	totalGain := 0.0
	totalLoss := 0.0
	refEle := smoothedEles[0]
	trend := 0 // 0: flat, 1: climbing, -1: descending

	for i := 1; i < n; i++ {
		e := smoothedEles[i]
		diff := e - refEle
		switch trend {
		case 0:
			if diff >= threshold {
				trend = 1
				totalGain += diff
				refEle = e
			} else if diff <= -threshold {
				trend = -1
				totalLoss += math.Abs(diff)
				refEle = e
			}
		case 1:
			if diff >= 0 {
				totalGain += diff
				refEle = e
			} else if diff <= -threshold {
				trend = -1
				totalLoss += math.Abs(diff)
				refEle = e
			}
		case -1:
			if diff <= 0 {
				totalLoss += math.Abs(diff)
				refEle = e
			} else if diff >= threshold {
				trend = 1
				totalGain += diff
				refEle = e
			}
		}
	}

	return result, totalGain, totalLoss, minEle, maxEle
}

// CalculateBoundingBox 计算点集的经纬度包围盒 [minLon, minLat, maxLon, maxLat]
func CalculateBoundingBox(points []RawPoint) BoundingBox {
	if len(points) == 0 {
		return BoundingBox{0, 0, 0, 0}
	}

	minLon, maxLon := points[0].Lon, points[0].Lon
	minLat, maxLat := points[0].Lat, points[0].Lat

	for _, p := range points[1:] {
		if p.Lon < minLon {
			minLon = p.Lon
		}
		if p.Lon > maxLon {
			maxLon = p.Lon
		}
		if p.Lat < minLat {
			minLat = p.Lat
		}
		if p.Lat > maxLat {
			maxLat = p.Lat
		}
	}

	return BoundingBox{minLon, minLat, maxLon, maxLat}
}

type provinceBox struct {
	Name   string
	MinLon float64
	MinLat float64
	MaxLon float64
	MaxLat float64
}

// 离线省份快速空间索引包围盒（涵盖中国各大主要省份及户外热门区域）
var provinceBoxes = []provinceBox{
	{"新疆", 73.66, 34.42, 96.38, 49.18},
	{"西藏", 78.41, 26.86, 99.11, 36.48},
	{"广东", 109.66, 20.22, 117.32, 25.52},
	{"北京", 115.42, 39.44, 117.51, 41.06},
	{"上海", 120.85, 30.67, 122.25, 31.87},
	{"浙江", 118.02, 27.05, 122.95, 31.18},
	{"江苏", 116.36, 30.76, 121.96, 35.12},
	{"四川", 97.35, 26.05, 108.55, 34.32},
	{"云南", 97.52, 21.14, 106.19, 29.25},
	{"青海", 89.58, 31.65, 103.07, 39.32},
	{"甘肃", 92.22, 32.52, 108.71, 42.79},
	{"陕西", 105.49, 31.70, 111.25, 39.59},
	{"重庆", 105.29, 28.16, 110.19, 32.20},
	{"贵州", 103.60, 24.62, 109.58, 29.22},
	{"广西", 104.45, 20.90, 112.06, 26.39},
	{"海南", 108.62, 18.16, 111.05, 20.17},
	{"福建", 115.84, 23.55, 120.72, 28.32},
	{"江西", 113.57, 24.48, 118.48, 30.08},
	{"湖南", 108.79, 24.64, 114.25, 30.13},
	{"湖北", 108.35, 29.09, 116.13, 33.33},
	{"河南", 110.35, 31.38, 116.65, 36.37},
	{"山东", 114.80, 34.38, 122.71, 38.40},
	{"山西", 110.24, 34.58, 114.55, 40.74},
	{"河北", 113.45, 36.05, 119.85, 42.67},
	{"天津", 116.71, 38.56, 118.07, 40.25},
	{"内蒙古", 97.17, 37.40, 126.07, 53.33},
	{"辽宁", 118.84, 38.72, 125.77, 43.43},
	{"吉林", 121.63, 40.87, 131.31, 46.30},
	{"黑龙江", 121.18, 43.43, 135.09, 53.56},
	{"宁夏", 104.28, 35.24, 107.65, 39.38},
	{"安徽", 114.88, 29.68, 119.64, 34.64},
	{"香港", 113.83, 22.15, 114.44, 22.56},
	{"澳门", 113.52, 22.10, 113.60, 22.22},
	{"台湾", 119.30, 21.89, 122.01, 25.30},
}

var (
	geocoderInitOnce sync.Once
)

// InitGeocoder 预热全局离线逆地理编码引擎（全内存 3D KD-Tree 空间加速索引）
func InitGeocoder(ctx context.Context) error {
	var err error
	geocoderInitOnce.Do(func() {
		geocoder := geocoding.GetDefault()
		err = geocoder.InitProgressive(ctx, nil)
	})
	return err
}

// QueryLocation 查询指定经纬度的地理位置信息（包含国家、省份、城市、FeatureClass、DistanceKm 等）
func QueryLocation(lat, lon float64) *geocoding.LocationInfo {
	geocoder := geocoding.GetDefault()
	if geocoder == nil {
		return nil
	}
	return geocoder.Lookup(lat, lon)
}

// queryMemoryGeodata 使用全内存 3D KD-Tree 逆地理编码引擎进行极速反查 (200ns)
func queryMemoryGeodata(lat, lon float64, ele ...float64) (country, province, city string, err error) {
	loc := QueryLocation(lat, lon)
	if loc == nil {
		return "", "", "", fmt.Errorf("no location matched for coord (%.6f, %.6f)", lat, lon)
	}

	country = strings.TrimSpace(loc.Country)
	if country == "China" || country == "CN" {
		country = "中国"
	}

	province = strings.TrimSpace(loc.Province)
	if province != "" {
		province = cleanProvinceName(province)
	}

	city = strings.TrimSpace(loc.City)
	if city != "" {
		city = cleanCityName(city)
	} else if loc.District != "" && (province == "北京" || province == "上海" || province == "天津" || province == "重庆") {
		// 直辖市若无 City，则使用直辖市名或 District
		city = province
	} else if loc.District != "" {
		city = cleanCityName(loc.District)
	}

	// 直辖市统一处理
	if province == "北京" || province == "上海" || province == "天津" || province == "重庆" {
		if city == "" || city == province {
			city = province
		}
	}

	if country == "" && province != "" {
		country = "中国"
	}

	if country == "" && province == "" {
		return "", "", "", fmt.Errorf("empty region info from geocoder")
	}

	return country, province, city, nil
}

// cleanProvinceName 将省份全称规范化为通用简称
func cleanProvinceName(p string) string {
	p = strings.TrimSpace(p)
	suffixes := []string{
		"维吾尔自治区", "壮族自治区", "回族自治区", "特别行政区", "自治区", "省", "市",
	}
	for _, suf := range suffixes {
		if strings.HasSuffix(p, suf) && len(p) > len(suf) {
			p = strings.TrimSuffix(p, suf)
			break
		}
	}
	return p
}

// cleanCityName 规范化城市/地区名称，剥离超长冗余后缀
func cleanCityName(c string) string {
	c = strings.TrimSpace(c)
	if c == "" {
		return ""
	}

	// 常见多民族自治州精简
	specialPrefectures := map[string]string{
		"阿坝藏族羌族自治州":   "阿坝州",
		"甘孜藏族自治州":     "甘孜州",
		"凉山彝族自治州":     "凉山州",
		"迪庆藏族自治州":     "迪庆州",
		"西双版纳傣族自治州":   "西双版纳",
		"大理白族自治州":     "大理",
		"楚雄彝族自治州":     "楚雄",
		"红河哈尼族彝族自治州": "红河",
		"文山壮族苗族自治州":   "文山",
		"德宏傣族景颇族自治州": "德宏",
		"怒江傈僳族自治州":   "怒江",
		"延边朝鲜族自治州":   "延边",
		"恩施土家族苗族自治州": "恩施",
		"湘西土家族苗族自治州": "湘西",
		"海北藏族自治州":     "海北",
		"海南藏族自治州":     "海南州",
		"黄南藏族自治州":     "黄南",
		"果洛藏族自治州":     "果洛",
		"玉树藏族自治州":     "玉树",
		"海西蒙古族藏族自治州": "海西",
		"博尔塔拉蒙古自治州":   "博尔塔拉",
		"巴音郭楞蒙古自治州":   "巴音郭楞",
		"克孜勒苏柯尔克孜自治州": "克孜勒苏",
		"伊犁哈萨克自治州":   "伊犁",
		"昌吉回族自治州":     "昌吉",
		"临夏回族自治州":     "临夏",
		"甘南藏族自治州":     "甘南",
	}
	if simplified, ok := specialPrefectures[c]; ok {
		return simplified
	}

	// 剥离自治州/地区后缀
	suffixes := []string{
		"藏族羌族自治州", "藏族自治州", "蒙古族藏族自治州", "回族自治州", "哈萨克自治州", "自治州",
		"特别行政区", "地区",
	}
	for _, suf := range suffixes {
		if strings.HasSuffix(c, suf) && len(c) > len(suf) {
			c = strings.TrimSuffix(c, suf)
			break
		}
	}

	// 如果以 "市" 结尾且长度大于 2（如 "广州市" -> "广州"，"成都市" -> "成都"，"林芝市" -> "林芝"）
	if strings.HasSuffix(c, "市") && len([]rune(c)) > 2 {
		c = strings.TrimSuffix(c, "市")
	}

	return c
}

// DetectRegion 根据经纬度离线判断国家、省份与城市（优先使用全内存 3D KD-Tree 逆地理编码引擎，降级使用内置空间包围盒）
func DetectRegion(lat, lon float64, ele ...float64) (country, province, city string) {
	// 1. 优先调用全内存 3D KD-Tree 逆地理编码引擎
	if c, p, ci, err := queryMemoryGeodata(lat, lon, ele...); err == nil && (c != "" || p != "") {
		if c == "" {
			c = "中国"
		}
		return c, p, ci
	}

	// 2. 降级使用内置省份经纬度包围盒
	if lat >= 3.86 && lat <= 53.55 && lon >= 73.66 && lon <= 135.05 {
		country = "中国"
		for _, box := range provinceBoxes {
			if lon >= box.MinLon && lon <= box.MaxLon && lat >= box.MinLat && lat <= box.MaxLat {
				province = box.Name
				city = box.Name
				return
			}
		}
		province = "中国其他"
		city = "中国其他"
		return
	}

	// 3. 境外默认推断
	country = "Global"
	province = "Global"
	city = "Global"
	return
}

