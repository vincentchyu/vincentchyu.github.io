package track

import "time"

// ActivityType 运动与交通类型枚举
type ActivityType string

const (
	TypeHiking       ActivityType = "hiking"        // 徒步 / 登山
	TypeTrailRunning ActivityType = "trail_running" // 越野跑
	TypeRunning      ActivityType = "running"       // 路跑
	TypeCycling      ActivityType = "cycling"       // 骑行
	TypeWalking      ActivityType = "walking"       // 行走 / 散步
	TypeSkateboarding ActivityType = "skateboarding" // 滑板
	TypeDriving      ActivityType = "driving"       // 驾车 / 自驾
	TypeTrain        ActivityType = "train"         // 火车 / 铁路
	TypeFlight       ActivityType = "flight"        // 飞机 / 航线
	TypeTransit      ActivityType = "transit"       // 兼容历史旅行/交通
)

// RawPoint 原始 GPS 点位
type RawPoint struct {
	Lat       float64
	Lon       float64
	Elevation float64
	Time      time.Time
	HeartRate int
	Speed     float64
}

// BoundingBox 经纬度包围盒 [minLon, minLat, maxLon, maxLat]
type BoundingBox [4]float64

// SummaryStats 全局足迹汇总统计
type SummaryStats struct {
	TotalDistanceKm float64              `json:"total_distance_km"` // 总里程 km
	TotalElevationM float64              `json:"total_elevation_m"` // 总爬升 m
	TotalDurationS  int64                `json:"total_duration_s"`  // 总耗时 s
	TotalActivities int                  `json:"total_activities"`  // 总活动数
	TypeCounts      map[ActivityType]int `json:"type_counts"`       // 各运动类型计数
	TypeDistances   map[ActivityType]float64 `json:"type_distances"` // 各类型里程
	ProvincesCount  int                  `json:"provinces_count"`   // 探索省份数
	CountriesCount  int                  `json:"countries_count"`   // 探索国家数
}

// TrackManifestItem 单条轨迹在 Manifest 中的简要索引
type TrackManifestItem struct {
	ID             string       `json:"id"`
	Title          string       `json:"title"`
	ActivityType   ActivityType `json:"type"`
	Country        string       `json:"country"`
	Province       string       `json:"province"`
	City           string       `json:"city,omitempty"`
	StartTime      string       `json:"start_time"`       // ISO 8601
	Year           int          `json:"year"`
	DistanceKm     float64      `json:"distance_km"`      // 里程 km
	ElevationGainM float64      `json:"elevation_gain_m"` // 爬升 m
	ElevationLossM float64      `json:"elevation_loss_m"` // 下降 m
	DurationS      int64        `json:"duration_s"`       // 耗时 s
	AvgSpeedKmh    float64      `json:"avg_speed_kmh"`    // 均速 km/h
	MaxElevationM  float64      `json:"max_elevation_m"`  // 最高海拔 m
	MinElevationM  float64      `json:"min_elevation_m"`  // 最低海拔 m
	AvgHeartRate   int          `json:"avg_hr,omitempty"` // 平均心率 bpm
	MaxHeartRate   int          `json:"max_hr,omitempty"` // 最大心率 bpm
	PhotoCount     int          `json:"photo_count,omitempty"` // 关联照片数
	BoundingBox    BoundingBox  `json:"bbox"`             // [minLon, minLat, maxLon, maxLat]
	StartCoord     [2]float64   `json:"start_coord"`      // [lon, lat]
	EndCoord       [2]float64   `json:"end_coord"`        // [lon, lat]
	DetailFile     string       `json:"detail_file,omitempty"`      // 对应分片路径 "data/tracks/{id}.json"
	HasTrack       bool         `json:"has_track"`                  // 是否支持/包含详细轨迹 (跑步 <10km / 行走 <5km 为 false 保护隐私)
}

// TrackPhotoItem 轨迹关联的摄影照片
type TrackPhotoItem struct {
	ID        string     `json:"id"`
	Filename  string     `json:"filename"`
	Thumbnail string     `json:"thumbnail"`  // 缩略图路径 (如 "pages/thumbnails/...")
	Original  string     `json:"original"`   // 原图路径
	Coord     [2]float64 `json:"coord"`      // [lon, lat]
	Time      string     `json:"time"`       // 拍摄时间
	Camera    string     `json:"camera,omitempty"`
	Lens      string     `json:"lens,omitempty"`
	Params    string     `json:"params,omitempty"` // "36mm · f/5.0 · 1/1000s · ISO 100"
}

// OverviewGeoJSON 全景轨迹骨架底网 GeoJSON
type OverviewGeoJSON struct {
	Type     string            `json:"type"`
	Features []OverviewFeature `json:"features"`
}

type OverviewFeature struct {
	Type       string               `json:"type"`
	Properties OverviewFeatureProps `json:"properties"`
	Geometry   OverviewLineGeometry `json:"geometry"`
}

type OverviewFeatureProps struct {
	ID         string       `json:"id"`
	Title      string       `json:"title"`
	Type       ActivityType `json:"type"`
	DistanceKm float64      `json:"distance_km"`
	Province   string       `json:"province,omitempty"`
	City       string       `json:"city,omitempty"`
	Country    string       `json:"country,omitempty"`
}

type OverviewLineGeometry struct {
	Type        string      `json:"type"`
	Coordinates [][]float64 `json:"coordinates"`
}

// TrackManifest 总清单索引 (纯元数据，极度轻量)
type TrackManifest struct {
	GeneratedAt time.Time           `json:"generated_at"`
	Stats       SummaryStats        `json:"stats"`
	Tracks      []TrackManifestItem `json:"tracks"`
}

// ProfilePoint 高程与运动指标剖面点
type ProfilePoint struct {
	DistanceKm float64 `json:"d"`            // 当前累计里程 km
	Elevation  float64 `json:"e"`            // 当前海拔 m
	HeartRate  int     `json:"hr,omitempty"` // 当前心率 bpm
	Index      int     `json:"i"`            // 对应坐标点索引
}

// TrackDetail 单条轨迹分片详情
type TrackDetail struct {
	ID             string           `json:"id"`
	Title          string           `json:"title"`
	ActivityType   ActivityType     `json:"type"`
	Country        string           `json:"country"`
	Province       string           `json:"province"`
	City           string           `json:"city,omitempty"`
	StartTime      string           `json:"start_time"`
	DistanceKm     float64          `json:"distance_km"`
	ElevationGainM float64          `json:"elevation_gain_m"`
	ElevationLossM float64          `json:"elevation_loss_m"`
	DurationS      int64            `json:"duration_s"`
	AvgSpeedKmh    float64          `json:"avg_speed_kmh"`
	MaxElevationM  float64          `json:"max_elevation_m"`
	MinElevationM  float64          `json:"min_elevation_m"`
	AvgHeartRate   int              `json:"avg_hr,omitempty"` // 平均心率 bpm
	MaxHeartRate   int              `json:"max_hr,omitempty"` // 最大心率 bpm
	BoundingBox    BoundingBox      `json:"bbox"`
	HasTrack       bool             `json:"has_track"`                  // 是否支持/包含详细轨迹 (跑步 <10km / 行走 <5km 为 false 保护隐私)
	// Coordinates 详细坐标 [[lon, lat, ele, timeUnix, hr], ...]
	Coordinates [][]float64        `json:"coordinates,omitempty"`
	// Profile 高程剖面精简数组
	Profile     []ProfilePoint     `json:"profile,omitempty"`
	// Photos 沿途拍摄照片
	Photos      []TrackPhotoItem   `json:"photos,omitempty"`
}
