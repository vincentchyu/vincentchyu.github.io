package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/vincentchyu/vincentchyu.github.io/internal/track"
)

func main() {
	homeDir, _ := os.UserHomeDir()
	defaultActive := filepath.Join(homeDir, ".config", "gpx")
	defaultPending := filepath.Join(homeDir, ".config", "gpx", "pending")
	defaultArchive := filepath.Join(homeDir, ".config", "gpx", "archive")
	defaultManifest := filepath.Join(homeDir, ".config", "gpx", "conflicts-manifest.json")

	manifestPath := flag.String("manifest", defaultManifest, "Path to conflicts-manifest.json")
	targetID := flag.String("id", "", "Target group ID to merge (e.g. grp_20241002_wutai)")
	targetName := flag.String("name", "", "Keyword match active track filename or title (e.g. 五台山)")
	filterType := flag.String("type", "", "Filter by activity type (hiking, running, cycling, walking, driving, trail_running)")
	mergeAll := flag.Bool("all", false, "Merge all conflict groups in manifest")
	listOnly := flag.Bool("list", false, "List all available conflict groups without merging")
	doArchive := flag.Bool("archive", true, "Archive merged pending files to ~/.config/gpx/archive/")
	archiveDir := flag.String("archive-dir", defaultArchive, "Archive directory path")
	doBackup := flag.Bool("backup", true, "Backup original active GPX to .bak before overwriting")
	dryRun := flag.Bool("dry-run", false, "Simulate merge without writing files")
	preferApple := flag.Bool("prefer-apple", false, "Prefer Apple Watch high-precision tracks as primary spine (bridge gaps with 2bulu)")
	flag.BoolVar(preferApple, "apple-primary", false, "Alias for -prefer-apple")

	// 便捷布尔 Flags (如 --hiking, --running 等)
	flagHiking := flag.Bool("hiking", false, "Merge only hiking tracks")
	flagRunning := flag.Bool("running", false, "Merge only running tracks")
	flagCycling := flag.Bool("cycling", false, "Merge only cycling tracks")
	flagWalking := flag.Bool("walking", false, "Merge only walking tracks")
	flagDriving := flag.Bool("driving", false, "Merge only driving tracks")
	flagTrail := flag.Bool("trail-running", false, "Merge only trail running tracks")

	flag.Parse()

	var targetActivity track.ActivityType
	if *flagHiking {
		targetActivity = track.TypeHiking
	} else if *flagRunning {
		targetActivity = track.TypeRunning
	} else if *flagCycling {
		targetActivity = track.TypeCycling
	} else if *flagWalking {
		targetActivity = track.TypeWalking
	} else if *flagDriving {
		targetActivity = track.TypeDriving
	} else if *flagTrail {
		targetActivity = track.TypeTrailRunning
	} else if *filterType != "" {
		targetActivity = track.ActivityType(strings.ToLower(strings.TrimSpace(*filterType)))
	}

	// 1. 读取或实时生成清单
	var manifest *track.ConflictsManifest
	if data, err := os.ReadFile(*manifestPath); err == nil {
		var m track.ConflictsManifest
		if json.Unmarshal(data, &m) == nil && len(m.ConflictGroups) > 0 {
			manifest = &m
		}
	}

	if manifest == nil {
		fmt.Println("ℹ️ 未发现现有清单文件，正在实时扫描冲突...")
		var err error
		manifest, err = track.ScanConflictsWithType(defaultActive, defaultPending, targetActivity)
		if err != nil {
			fmt.Printf("❌ 扫描冲突失败: %v\n", err)
			os.Exit(1)
		}
		_ = manifest.SaveManifestToFile(*manifestPath)
	}

	// 2. 仅列出清单
	if *listOnly {
		listGroups := manifest.ConflictGroups
		if targetActivity != "" {
			var filtered []track.ConflictGroup
			for _, grp := range manifest.ConflictGroups {
				if grp.ActiveActivity == targetActivity {
					filtered = append(filtered, grp)
				}
			}
			listGroups = filtered
		}
		fmt.Printf("📋 可合并的冲突组清单 (共 %d 组):\n\n", len(listGroups))
		for i, grp := range listGroups {
			fmt.Printf("[%d] 🆔 ID: \033[1;36m%s\033[0m [%s]\n", i+1, grp.GroupID, grp.ActiveActivity)
			fmt.Printf("    主轨迹: %s\n", grp.ActiveFilename)
			fmt.Printf("    时间: %s ~ %s | 待合并子段: %d 个\n\n", grp.ActiveStart, grp.ActiveEnd, len(grp.PendingItems))
		}
		return
	}

	// 3. 匹配目标组
	var targets []track.ConflictGroup
	if *mergeAll {
		targets = manifest.ConflictGroups
	} else if targetActivity != "" {
		for _, grp := range manifest.ConflictGroups {
			if grp.ActiveActivity == targetActivity {
				targets = append(targets, grp)
			}
		}
	} else if *targetID != "" {
		for _, grp := range manifest.ConflictGroups {
			if strings.EqualFold(grp.GroupID, *targetID) {
				targets = append(targets, grp)
			}
		}
	} else if *targetName != "" {
		keyword := strings.ToLower(*targetName)
		for _, grp := range manifest.ConflictGroups {
			if strings.Contains(strings.ToLower(grp.ActiveFilename), keyword) ||
				strings.Contains(strings.ToLower(grp.ActiveTitle), keyword) ||
				strings.Contains(strings.ToLower(grp.GroupID), keyword) {
				targets = append(targets, grp)
			}
		}
	} else {
		fmt.Println("⚠️ 请指定要合并的目标:")
		fmt.Println("   - 使用 --hiking / --running / -type <Type> 按运动类型批量合并")
		fmt.Println("   - 使用 -id <GroupID> 合并指定组 (例如: -id grp_20241002_wutai)")
		fmt.Println("   - 使用 -name <Keyword> 按名称合并 (例如: -name 五台山)")
		fmt.Println("   - 使用 -all 合并清单中所有组")
		fmt.Println("   - 使用 -list 查看所有冲突组")
		os.Exit(1)
	}

	if len(targets) == 0 {
		fmt.Println("❌ 未匹配到任何符合条件的冲突组")
		os.Exit(1)
	}

	fmt.Printf("🎯 即将执行合并: 共匹配到 %d 组轨迹\n", len(targets))
	if *dryRun {
		fmt.Println("⚠️ [演练模式 Dry-Run] 不会修改任何文件")
	}
	fmt.Println("================================================================================")

	if *doArchive && !*dryRun {
		_ = os.MkdirAll(*archiveDir, 0755)
	}

	mergedCount := 0
	for i, grp := range targets {
		fmt.Printf("\n▶ [%d/%d] 正在合并组: \033[1;36m%s\033[0m\n", i+1, len(targets), grp.GroupID)
		fmt.Printf("   📍 主轨迹: %s (原点数: %d)\n", grp.ActiveFilename, grp.ActivePoints)

		var pendingPaths []string
		for _, item := range grp.PendingItems {
			pendingPaths = append(pendingPaths, item.PendingFile)
			fmt.Printf("   🔗 融合子段: %s (%d 点)\n", item.PendingFilename, item.PendingPoints)
		}

		if *dryRun {
			fmt.Println("   ✓ [Dry-Run] 模拟完成")
			continue
		}

		res, err := track.MergeGPXTracksWithOptions(grp.ActiveFile, pendingPaths, track.MergeOptions{
			BackupActive: *doBackup,
			PreferApple:  *preferApple,
		})
		if err != nil {
			fmt.Printf("   ❌ 合并失败: %v\n", err)
			continue
		}

		fmt.Printf("   ✅ 合并成功!\n")
		fmt.Printf("      - 点数: %d ──► \033[1;32m%d\033[0m (补充盲区点: %d)\n",
			res.OriginalPoints, res.MergedPoints, res.FilledPoints)
		fmt.Printf("      - 心率: 成功插值 \033[1;35m%d\033[0m 个点 (平均心率: %d bpm | 最高: %d bpm)\n",
			res.InterpolatedHR, res.AvgHRAfter, res.MaxHRAfter)
		fmt.Printf("      - 里程: %.2f km | 爬升: %.0f m\n", res.DistanceKm, res.ElevationGainM)

		// 归档处理过的 pending 文件
		if *doArchive {
			for _, pFile := range pendingPaths {
				destFile := filepath.Join(*archiveDir, filepath.Base(pFile))
				if err := os.Rename(pFile, destFile); err == nil {
					fmt.Printf("      📦 已归档: %s ──► %s\n", filepath.Base(pFile), filepath.Base(destFile))
				}
			}
		}

		mergedCount++
	}

	fmt.Println("\n================================================================================")
	fmt.Printf("🎉 合并完成! 成功处理 %d / %d 组轨迹\n", mergedCount, len(targets))
	fmt.Println("💡 提示: 您可以运行 `go run cmd/update-tracks/main.go` 重新生成足迹分片索引以在前端查看最新高精融合效果。")
	fmt.Println("================================================================================")
}
