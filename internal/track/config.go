package track

import (
	"encoding/json"
	"os"
	"strconv"
)

// TrackOverride 人工校准覆盖配置（针对少数极端跳变或手机端传感器融合更精准的记录）
type TrackOverride struct {
	DistanceKm     *float64      `json:"distance_km,omitempty"`
	ElevationGainM *float64      `json:"elevation_gain_m,omitempty"`
	ElevationLossM *float64      `json:"elevation_loss_m,omitempty"`
	Title          *string       `json:"title,omitempty"`
	Type           *ActivityType `json:"type,omitempty"`
}

// ActivityThreshold 单个运动类型的轨迹展示与隐私过滤阈值配置
type ActivityThreshold struct {
	MinDistanceKm   float64 `json:"min_distance_km,omitempty"`
	MinAvgHeartRate float64 `json:"min_avg_heart_rate,omitempty"`
}

// TrackConfig 轨迹处理流水线配置
type TrackConfig struct {
	// 各运动类型展示轨迹(has_track=true)的阈值配置（按运动类型聚合）
	// 里程条件与平均心率条件为“或”的关系：满足任意一个配置的有效正阈值即可生成完整轨迹
	Thresholds map[ActivityType]ActivityThreshold `json:"thresholds"`

	// 针对特定轨迹的手动校准覆盖项（Key 可为 12位ID 或 GPX文件名无后缀）
	Overrides map[string]TrackOverride `json:"overrides,omitempty"`
}

// DefaultTrackConfig 默认阈值配置（跑步 5.0km，行走 5.0km 或平均心率 >= 120bpm，其他类型 0 默认全展示）
func DefaultTrackConfig() *TrackConfig {
	return &TrackConfig{
		Thresholds: map[ActivityType]ActivityThreshold{
			TypeRunning:      {MinDistanceKm: 5.0, MinAvgHeartRate: 0.0},
			TypeWalking:      {MinDistanceKm: 5.0, MinAvgHeartRate: 120.0},
			TypeHiking:       {MinDistanceKm: 0.0, MinAvgHeartRate: 0.0},
			TypeTrailRunning: {MinDistanceKm: 0.0, MinAvgHeartRate: 0.0},
			TypeCycling:       {MinDistanceKm: 0.0, MinAvgHeartRate: 0.0},
			TypeSkateboarding: {MinDistanceKm: 0.0, MinAvgHeartRate: 0.0},
			TypeDriving:       {MinDistanceKm: 0.0, MinAvgHeartRate: 0.0},
			TypeTrain:         {MinDistanceKm: 0.0, MinAvgHeartRate: 0.0},
			TypeFlight:        {MinDistanceKm: 0.0, MinAvgHeartRate: 0.0},
			TypeTransit:       {MinDistanceKm: 0.0, MinAvgHeartRate: 0.0},
		},
		Overrides: make(map[string]TrackOverride),
	}
}

// GetOverride 获取指定轨迹的校准配置项（按 ID 或文件名索引）
func (c *TrackConfig) GetOverride(id, baseName string) (TrackOverride, bool) {
	if c == nil || c.Overrides == nil {
		return TrackOverride{}, false
	}
	if ov, exists := c.Overrides[id]; exists {
		return ov, true
	}
	if baseName != "" {
		if ov, exists := c.Overrides[baseName]; exists {
			return ov, true
		}
	}
	return TrackOverride{}, false
}

// ShouldGenerateTrack 判定某运动类型、里程及平均心率是否应生成完整轨迹
// 里程判断与平均心率判断为“或”的关系：满足任意一个配置的有效阈值即生成轨迹
func (c *TrackConfig) ShouldGenerateTrack(actType ActivityType, distanceKm float64, avgHR int) bool {
	if c == nil || c.Thresholds == nil {
		c = DefaultTrackConfig()
	}
	th, exists := c.Thresholds[actType]
	if !exists {
		// 未显式配置门槛的运动类型，默认全部展示
		return true
	}

	// 如果两个阈值均 <= 0，默认展示轨迹
	if th.MinDistanceKm <= 0 && th.MinAvgHeartRate <= 0 {
		return true
	}

	// 里程与平均心率是“或”的关系：只要满足其中任意一个配置的有效正阈值即可
	if th.MinDistanceKm > 0 && distanceKm >= th.MinDistanceKm {
		return true
	}
	if th.MinAvgHeartRate > 0 && float64(avgHR) >= th.MinAvgHeartRate {
		return true
	}

	return false
}

// LoadTrackConfig 优先从指定路径加载，未指定时依次尝试 tracks.config.json, configs/tracks.config.json 等
func LoadTrackConfig(customPath ...string) (*TrackConfig, string) {
	cfg := DefaultTrackConfig()
	var loadedPath string

	var candidatePaths []string
	for _, p := range customPath {
		if p != "" {
			candidatePaths = append(candidatePaths, p)
		}
	}
	if envPath := os.Getenv("TRACKS_CONFIG"); envPath != "" {
		candidatePaths = append(candidatePaths, envPath)
	}
	candidatePaths = append(candidatePaths,
		"tracks.config.json",
		"configs/tracks.config.json",
		"configs/tracks.json",
	)

	for _, p := range candidatePaths {
		data, err := os.ReadFile(p)
		if err == nil {
			type rawActivityThreshold struct {
				MinDistanceKm   *float64 `json:"min_distance_km"`
				MinAvgHeartRate *float64 `json:"min_avg_heart_rate"`
				MinHeartRateAvg *float64 `json:"min_heart_rate_avg"`
				MinAvgHR        *float64 `json:"min_avg_hr"`
				MinHeartRate    *float64 `json:"min_heart_rate"`
				MinHeartRateZh  *float64 `json:"min_心率"`
				MinHR           *float64 `json:"min_hr"`
			}
			var parsed struct {
				Thresholds        map[string]rawActivityThreshold `json:"thresholds"`
				MinDistanceKm     map[string]float64              `json:"min_distance_km"`
				MinAvgHeartRate   map[string]float64              `json:"min_avg_heart_rate"`
				MinHeartRateAvg   map[string]float64              `json:"min_heart_rate_avg"`
				MinAvgHR          map[string]float64              `json:"min_avg_hr"`
				MinHeartRate      map[string]float64              `json:"min_heart_rate"`
				MinHeartRateZh    map[string]float64              `json:"min_心率"`
				MinHR             map[string]float64              `json:"min_hr"`
				Overrides         map[string]TrackOverride        `json:"overrides"`
			}
			if err := json.Unmarshal(data, &parsed); err == nil {
				// 1. 优先解析按运动类型聚合的子对象 thresholds
				if parsed.Thresholds != nil {
					for k, v := range parsed.Thresholds {
						act := ActivityType(k)
						curr := cfg.Thresholds[act]
						if v.MinDistanceKm != nil {
							curr.MinDistanceKm = *v.MinDistanceKm
						}
						if v.MinAvgHeartRate != nil {
							curr.MinAvgHeartRate = *v.MinAvgHeartRate
						} else if v.MinHeartRateAvg != nil {
							curr.MinAvgHeartRate = *v.MinHeartRateAvg
						} else if v.MinAvgHR != nil {
							curr.MinAvgHeartRate = *v.MinAvgHR
						} else if v.MinHeartRate != nil {
							curr.MinAvgHeartRate = *v.MinHeartRate
						} else if v.MinHeartRateZh != nil {
							curr.MinAvgHeartRate = *v.MinHeartRateZh
						} else if v.MinHR != nil {
							curr.MinAvgHeartRate = *v.MinHR
						}
						cfg.Thresholds[act] = curr
					}
				}

				// 2. 兼容旧版平铺格式 (min_distance_km / min_avg_heart_rate / min_heart_rate / min_心率 / min_hr)
				if parsed.MinDistanceKm != nil {
					for k, v := range parsed.MinDistanceKm {
						act := ActivityType(k)
						curr := cfg.Thresholds[act]
						curr.MinDistanceKm = v
						cfg.Thresholds[act] = curr
					}
				}
				assignHR := func(m map[string]float64) {
					if m != nil {
						for k, v := range m {
							act := ActivityType(k)
							curr := cfg.Thresholds[act]
							curr.MinAvgHeartRate = v
							cfg.Thresholds[act] = curr
						}
					}
				}
				assignHR(parsed.MinAvgHeartRate)
				assignHR(parsed.MinHeartRateAvg)
				assignHR(parsed.MinAvgHR)
				assignHR(parsed.MinHeartRate)
				assignHR(parsed.MinHeartRateZh)
				assignHR(parsed.MinHR)

				if parsed.Overrides != nil {
					cfg.Overrides = parsed.Overrides
				}
				loadedPath = p
				break
			}
		}
	}

	// 环境变量覆盖里程（如 TRACK_MIN_DISTANCE_RUNNING=5.0）
	envDistMapping := map[string]ActivityType{
		"TRACK_MIN_DISTANCE_RUNNING":       TypeRunning,
		"TRACK_MIN_DISTANCE_WALKING":       TypeWalking,
		"TRACK_MIN_DISTANCE_HIKING":        TypeHiking,
		"TRACK_MIN_DISTANCE_TRAIL_RUNNING": TypeTrailRunning,
		"TRACK_MIN_DISTANCE_CYCLING":       TypeCycling,
		"TRACK_MIN_DISTANCE_SKATEBOARDING": TypeSkateboarding,
		"TRACK_MIN_DISTANCE_DRIVING":       TypeDriving,
	}
	for envKey, actType := range envDistMapping {
		if valStr := os.Getenv(envKey); valStr != "" {
			if val, err := strconv.ParseFloat(valStr, 64); err == nil {
				curr := cfg.Thresholds[actType]
				curr.MinDistanceKm = val
				cfg.Thresholds[actType] = curr
			}
		}
	}

	// 环境变量覆盖平均心率（如 TRACK_MIN_AVG_HEART_RATE_WALKING=120 或 TRACK_MIN_HEART_RATE_WALKING=120）
	envHRMapping := map[string]ActivityType{
		"TRACK_MIN_AVG_HEART_RATE_RUNNING":       TypeRunning,
		"TRACK_MIN_AVG_HEART_RATE_WALKING":       TypeWalking,
		"TRACK_MIN_AVG_HEART_RATE_HIKING":        TypeHiking,
		"TRACK_MIN_AVG_HEART_RATE_TRAIL_RUNNING": TypeTrailRunning,
		"TRACK_MIN_AVG_HEART_RATE_CYCLING":       TypeCycling,
		"TRACK_MIN_AVG_HEART_RATE_SKATEBOARDING": TypeSkateboarding,
		"TRACK_MIN_AVG_HEART_RATE_DRIVING":       TypeDriving,
		"TRACK_MIN_HEART_RATE_RUNNING":           TypeRunning,
		"TRACK_MIN_HEART_RATE_WALKING":           TypeWalking,
		"TRACK_MIN_HEART_RATE_HIKING":            TypeHiking,
		"TRACK_MIN_HEART_RATE_TRAIL_RUNNING":     TypeTrailRunning,
		"TRACK_MIN_HEART_RATE_CYCLING":           TypeCycling,
		"TRACK_MIN_HEART_RATE_SKATEBOARDING":     TypeSkateboarding,
		"TRACK_MIN_HEART_RATE_DRIVING":           TypeDriving,
	}
	for envKey, actType := range envHRMapping {
		if valStr := os.Getenv(envKey); valStr != "" {
			if val, err := strconv.ParseFloat(valStr, 64); err == nil {
				curr := cfg.Thresholds[actType]
				curr.MinAvgHeartRate = val
				cfg.Thresholds[actType] = curr
			}
		}
	}

	return cfg, loadedPath
}
