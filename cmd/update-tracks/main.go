package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/vincentchyu/vincentchyu.github.io/internal/track"
)

func main() {
	userHome, _ := os.UserHomeDir()
	defaultGpxDir := filepath.Join(userHome, ".config", "gpx")

	gpxDir := flag.String("dir", defaultGpxDir, "Path to GPX directory containing tracks")
	outDir := flag.String("out", "web/tracks/data", "Output directory for manifest and track chunks")
	photosDir := flag.String("photos", "web/photography/data/photos", "Path to photography json data")
	suggestRename := flag.Bool("suggest-rename", false, "Suggest standardized filenames for all GPX files")
	runRename := flag.Bool("run", false, "Execute and apply renaming on filesystem when used with --suggest-rename")
	cleanOrphans := flag.Bool("clean", true, "Automatically prune obsolete/orphan track chunk json files")
	clearOrphans := flag.Bool("clear", false, "Alias for --clean")
	prettyJSON := flag.Bool("pretty", false, "Output formatted pretty JSON for manifest.json instead of compact minified JSON")
	configFile := flag.String("config", "tracks.config.json", "Path to track processing configuration file (JSON)")
	flag.Parse()

	// 如果是 --suggest-rename 模式且用户未自定义 -dir，优先检查 ~/.config/gpx/pending
	targetScanDir := *gpxDir
	isDefaultDir := (*gpxDir == defaultGpxDir)
	if *suggestRename && isDefaultDir {
		pendingDir := filepath.Join(defaultGpxDir, "pending")
		if info, err := os.Stat(pendingDir); err == nil && info.IsDir() {
			targetScanDir = pendingDir
			log.Printf("📁 [待整理池模式] 优先扫描待处理目录: %s", targetScanDir)
		}
	}

	// 检查目录有效性
	if _, err := os.Stat(targetScanDir); os.IsNotExist(err) {
		// 备用兜底检查
		fallbackDir := filepath.Join(userHome, "Pictures", "GPS", "test", "gpx")
		if _, err := os.Stat(fallbackDir); err == nil {
			log.Printf("Default dir %s not found, falling back to %s", targetScanDir, fallbackDir)
			targetScanDir = fallbackDir
		} else {
			log.Fatalf("GPX source directory does not exist: %s", targetScanDir)
		}
	}

	// 预加载摄影作品数据
	allPhotos, err := track.LoadAllPhotographyPhotos(*photosDir)
	if err != nil {
		log.Printf("⚠️ Warning: Failed to load photography data: %v", err)
	} else if len(allPhotos) > 0 {
		log.Printf("📷 Loaded %d photography assets from %s", len(allPhotos), *photosDir)
	}

	// 预加载离线逆地理编码引擎 (全内存 3D KD-Tree 极速空间索引)
	if err := track.InitGeocoder(context.Background()); err != nil {
		log.Printf("⚠️ Warning: Failed to init geocoder: %v", err)
	} else {
		log.Printf("🗺️ 离线逆地理编码引擎预热就绪 (纯内存 3D KD-Tree)")
	}

	// 加载轨迹生成阈值配置 (支持 tracks.config.json 与环境变量)
	trackCfg, loadedCfgPath := track.LoadTrackConfig(*configFile)
	if loadedCfgPath != "" {
		log.Printf("⚙️ 已加载轨迹生成阈值配置 [%s]: 跑步>=%.1fkm, 行走>=%.1fkm(或平均HR>=%.0f), 徒步>=%.1fkm",
			loadedCfgPath,
			trackCfg.Thresholds[track.TypeRunning].MinDistanceKm,
			trackCfg.Thresholds[track.TypeWalking].MinDistanceKm,
			trackCfg.Thresholds[track.TypeWalking].MinAvgHeartRate,
			trackCfg.Thresholds[track.TypeHiking].MinDistanceKm)
	} else {
		log.Printf("⚙️ 使用内置默认轨迹生成阈值配置: 跑步>=%.1fkm, 行走>=%.1fkm(或平均HR>=%.0f), 徒步>=%.1fkm",
			trackCfg.Thresholds[track.TypeRunning].MinDistanceKm,
			trackCfg.Thresholds[track.TypeWalking].MinDistanceKm,
			trackCfg.Thresholds[track.TypeWalking].MinAvgHeartRate,
			trackCfg.Thresholds[track.TypeHiking].MinDistanceKm)
	}

	log.Printf("🔍 Scanning GPX files from: %s", targetScanDir)

	entries, err := os.ReadDir(targetScanDir)
	if err != nil {
		log.Fatalf("Failed to read GPX directory: %v", err)
	}

	var gpxFiles []string
	for _, e := range entries {
		// 明确忽略任何子目录（如 pending），只处理当前层级的 .gpx 文件
		if !e.IsDir() && strings.ToLower(filepath.Ext(e.Name())) == ".gpx" {
			gpxFiles = append(gpxFiles, filepath.Join(targetScanDir, e.Name()))
		}
	}

	if len(gpxFiles) == 0 {
		log.Printf("⚠️ No .gpx files found in %s", targetScanDir)
		return
	}

	log.Printf("Found %d GPX files. Processing...", len(gpxFiles))

	// 创建输出目录
	tracksOutDir := filepath.Join(*outDir, "tracks")
	if err := os.MkdirAll(tracksOutDir, 0755); err != nil {
		log.Fatalf("Failed to create output dir: %v", err)
	}

	var manifestItems []track.TrackManifestItem
	var details []*track.TrackDetail
	var overviewFeatures []track.OverviewFeature

	stats := track.SummaryStats{
		TypeCounts:    make(map[track.ActivityType]int),
		TypeDistances: make(map[track.ActivityType]float64),
	}
	provinceSet := make(map[string]bool)
	countrySet := make(map[string]bool)

	for _, file := range gpxFiles {
		detail, item, simplifiedCoords, err := track.ParseGPXFileWithConfig(file, trackCfg)
		if err != nil {
			log.Printf("⚠️ Skip %s: %v", filepath.Base(file), err)
			continue
		}

		// 关联摄影资产 (仅在具有完整轨迹展示时匹配)
		if item.HasTrack && len(allPhotos) > 0 {
			matched := track.MatchPhotosWithDetail(detail, allPhotos)
			if len(matched) > 0 {
				detail.Photos = matched
				item.PhotoCount = len(matched)
				log.Printf("📷 %s -> Linked %d photography assets!", item.Title, len(matched))
			}
		}

		// 收集全景骨架线段数据
		if item.HasTrack && len(simplifiedCoords) > 0 {
			overviewFeatures = append(overviewFeatures, track.OverviewFeature{
				Type: "Feature",
				Properties: track.OverviewFeatureProps{
					ID:         item.ID,
					Title:      item.Title,
					Type:       item.ActivityType,
					DistanceKm: item.DistanceKm,
					Province:   item.Province,
					City:       item.City,
					Country:    item.Country,
				},
				Geometry: track.OverviewLineGeometry{
					Type:        "LineString",
					Coordinates: simplifiedCoords,
				},
			})
		}

		manifestItems = append(manifestItems, *item)
		details = append(details, detail)
		if item.AvgHeartRate > 0 {
			log.Printf("❤️ %s -> AvgHR: %d bpm, MaxHR: %d bpm (HasTrack: %v)", item.Title, item.AvgHeartRate, item.MaxHeartRate, item.HasTrack)
		}

		// 累计统计
		stats.TotalDistanceKm += item.DistanceKm
		stats.TotalElevationM += item.ElevationGainM
		stats.TotalDurationS += item.DurationS
		stats.TotalActivities++
		stats.TypeCounts[item.ActivityType]++
		stats.TypeDistances[item.ActivityType] += item.DistanceKm

		if item.Province != "" && item.Province != "Global" {
			provinceSet[item.Province] = true
		}
		if item.Country != "" {
			countrySet[item.Country] = true
		}

		if *suggestRename {
			datePart := item.StartTime[:10]
			datePart = strings.ReplaceAll(datePart, "-", "")
			country := item.Country
			if country == "" {
				country = "中国"
			}
			province := item.Province
			if province == "" || province == "Global" {
				province = "户外"
			}
			suggested := fmt.Sprintf("%s-%s-%s-%s-%s.gpx", item.ActivityType, country, province, sanitizeFilename(item.Title), datePart)
			oldName := filepath.Base(file)

			if oldName == suggested {
				log.Printf("✓ [已规范] %s", oldName)
			} else {
				if *runRename {
					targetPath := filepath.Join(filepath.Dir(file), suggested)
					if _, err := os.Stat(targetPath); err == nil && targetPath != file {
						log.Printf("⚠️ 跳过 (目标文件已存在): [%s] -> [%s]", oldName, suggested)
					} else {
						if err := os.Rename(file, targetPath); err != nil {
							log.Printf("❌ 重命名失败 [%s] -> [%s]: %v", oldName, suggested, err)
						} else {
							log.Printf("✅ 已重命名: [%s] -> [%s]", oldName, suggested)
						}
					}
				} else {
					fmt.Printf("建议重命名: [%s] -> [%s] (附带 --run 参数可直接应用)\n", oldName, suggested)
				}
			}
		}
	}

	stats.ProvincesCount = len(provinceSet)
	stats.CountriesCount = len(countrySet)

	// 按时间倒序排序（最新轨迹排在最前）
	sort.Slice(manifestItems, func(i, j int) bool {
		return manifestItems[i].StartTime > manifestItems[j].StartTime
	})

	// 1. 写入单条轨迹分片 JSON (短途隐私记录不写入详情分片)
	for _, d := range details {
		if !d.HasTrack {
			continue
		}
		chunkPath := filepath.Join(tracksOutDir, fmt.Sprintf("%s.json", d.ID))
		chunkData, err := json.Marshal(d)
		if err != nil {
			log.Printf("Failed to marshal track %s: %v", d.ID, err)
			continue
		}
		if err := os.WriteFile(chunkPath, chunkData, 0644); err != nil {
			log.Printf("Failed to write chunk %s: %v", chunkPath, err)
		}
	}

	// 2. 写入全景轻量骨架底网 overview.geojson
	overviewDoc := track.OverviewGeoJSON{
		Type:     "FeatureCollection",
		Features: overviewFeatures,
	}
	overviewData, err := json.Marshal(overviewDoc)
	if err != nil {
		log.Fatalf("Failed to marshal overview geojson: %v", err)
	}
	overviewPath := filepath.Join(*outDir, "overview.geojson")
	if err := os.WriteFile(overviewPath, overviewData, 0644); err != nil {
		log.Fatalf("Failed to write overview geojson: %v", err)
	}
	log.Printf("🗺️ Generated overview GeoJSON (%d tracks, %d bytes) at %s", len(overviewFeatures), len(overviewData), overviewPath)

	// 3. 写入总清单 manifest.json (默认紧凑极致压缩，极度轻量快速)
	manifest := track.TrackManifest{
		GeneratedAt: time.Now(),
		Stats:       stats,
		Tracks:      manifestItems,
	}

	var manifestData []byte
	if *prettyJSON {
		manifestData, err = json.MarshalIndent(manifest, "", "  ")
	} else {
		manifestData, err = json.Marshal(manifest)
	}
	if err != nil {
		log.Fatalf("Failed to marshal manifest: %v", err)
	}

	manifestPath := filepath.Join(*outDir, "manifest.json")
	if err := os.WriteFile(manifestPath, manifestData, 0644); err != nil {
		log.Fatalf("Failed to write manifest: %v", err)
	}

	log.Printf("✅ Success! Generated manifest at %s", manifestPath)
	log.Printf("📊 Summary: %d tracks | %.2f km total distance | %.0f m elevation gain | %d provinces",
		stats.TotalActivities, stats.TotalDistanceKm, stats.TotalElevationM, stats.ProvincesCount)
	for t, count := range stats.TypeCounts {
		log.Printf("   - %-15s: %2d tracks (%.1f km)", t, count, stats.TypeDistances[t])
	}

	// 4. 清理无用孤儿分片 JSON 文件 (Prune obsolete track chunks)
	if *cleanOrphans || *clearOrphans {
		validChunkIDs := make(map[string]bool)
		for _, item := range manifestItems {
			if item.HasTrack {
				validChunkIDs[item.ID] = true
			}
		}

		existingFiles, err := os.ReadDir(tracksOutDir)
		if err == nil {
			var pruned []string
			for _, ef := range existingFiles {
				if ef.IsDir() || strings.ToLower(filepath.Ext(ef.Name())) != ".json" {
					continue
				}
				fileID := strings.TrimSuffix(ef.Name(), filepath.Ext(ef.Name()))
				if !validChunkIDs[fileID] {
					obsoletePath := filepath.Join(tracksOutDir, ef.Name())
					if err := os.Remove(obsoletePath); err == nil {
						pruned = append(pruned, ef.Name())
					}
				}
			}
			if len(pruned) > 0 {
				log.Printf("🧹 Pruned %d obsolete/orphan track chunk files: %v", len(pruned), pruned)
			} else {
				log.Printf("✨ All track chunk JSON files are clean and consistent (no orphans).")
			}
		}
	}
}

func sanitizeFilename(s string) string {
	s = strings.TrimSpace(s)
	replacer := strings.NewReplacer(
		" ", "_",
		"/", "_",
		"\\", "_",
		":", "_",
		"*", "_",
		"?", "_",
		"\"", "_",
		"<", "_",
		">", "_",
		"|", "_",
	)
	s = replacer.Replace(s)
	// 避免连续的下划线
	for strings.Contains(s, "__") {
		s = strings.ReplaceAll(s, "__", "_")
	}
	return strings.Trim(s, "_")
}
