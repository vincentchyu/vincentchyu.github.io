package main

import (
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
	defaultOut := filepath.Join(homeDir, ".config", "gpx", "conflicts-manifest.json")
	defaultMD := filepath.Join(homeDir, ".config", "gpx", "conflicts-report.md")

	activeDir := flag.String("active", defaultActive, "Active GPX directory path")
	pendingDir := flag.String("pending", defaultPending, "Pending GPX directory path")
	outputJSON := flag.String("output", defaultOut, "Output conflict manifest JSON path")
	outputMD := flag.String("md", defaultMD, "Output conflict markdown report path")
	filterType := flag.String("type", "", "Filter by activity type (hiking, running, cycling, walking, driving, trail_running)")

	// 便捷布尔 Flags (如 --hiking, --running 等)
	flagHiking := flag.Bool("hiking", false, "Filter only hiking tracks")
	flagRunning := flag.Bool("running", false, "Filter only running tracks")
	flagCycling := flag.Bool("cycling", false, "Filter only cycling tracks")
	flagWalking := flag.Bool("walking", false, "Filter only walking tracks")
	flagDriving := flag.Bool("driving", false, "Filter only driving tracks")
	flagTrail := flag.Bool("trail-running", false, "Filter only trail running tracks")

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

	fmt.Println("🔍 正在扫描时空重合与冲突轨迹...")
	fmt.Printf("   📁 正式包目录: %s\n", *activeDir)
	fmt.Printf("   📦 预备包目录: %s\n", *pendingDir)
	if targetActivity != "" {
		fmt.Printf("   🏷️ 指定运动类型: \033[1;35m%s\033[0m\n", targetActivity)
	}
	fmt.Println()

	manifest, err := track.ScanConflictsWithType(*activeDir, *pendingDir, targetActivity)
	if err != nil {
		fmt.Printf("❌ 扫描失败: %v\n", err)
		os.Exit(1)
	}

	// 保存 JSON 清单
	if err := manifest.SaveManifestToFile(*outputJSON); err != nil {
		fmt.Printf("⚠️ 保存 JSON 清单失败: %v\n", err)
	} else {
		fmt.Printf("✅ 冲突结构化清单已保存至: %s\n", *outputJSON)
	}

	// 生成 Markdown 报告
	generateMarkdownReport(manifest, *outputMD)
	fmt.Printf("📄 详细比对报告已导出至: %s\n\n", *outputMD)

	// 控制台汇总展示
	fmt.Println("================================================================================")
	fmt.Printf("📊 扫描结果汇总: 正式包 %d 条 | 预备包 %d 条 | 发现 %d 组待合并冲突\n",
		manifest.TotalActive, manifest.TotalPending, len(manifest.ConflictGroups))
	fmt.Println("================================================================================")

	for i, grp := range manifest.ConflictGroups {
		fmt.Printf("\n[%d/%d] 🆔 组编号: \033[1;36m%s\033[0m\n", i+1, len(manifest.ConflictGroups), grp.GroupID)
		fmt.Printf("    📍 正式包主轨迹: \033[1;32m%s\033[0m\n", grp.ActiveFilename)
		fmt.Printf("       时间: %s ~ %s | 点数: %d | 已有心率: %v\n",
			grp.ActiveStart, grp.ActiveEnd, grp.ActivePoints, grp.ActiveHasHR)
		fmt.Printf("       💡 推荐动作: \033[1;33m%s\033[0m\n", grp.SuggestAction)
		fmt.Printf("    🔗 关联的预备包分段 (%d 个):\n", len(grp.PendingItems))

		for _, item := range grp.PendingItems {
			hrTip := "无心率"
			if item.PendingHasHR {
				hrTip = fmt.Sprintf("❤️ 均心率 %d / 最高 %d", item.PendingAvgHR, item.PendingMaxHR)
			}
			fmt.Printf("       - %s\n", item.PendingFilename)
			fmt.Printf("         类型: %s | 重合比例: %.1f%% (%ds) | 点数: %d | %s\n",
				item.ConflictType, item.OverlapRatio*100, item.OverlapDuration, item.PendingPoints, hrTip)
		}
	}

	fmt.Println("\n================================================================================")
	fmt.Println("🚀 接下来可以使用 merge-tracks 进行指定或批量合并:")
	fmt.Println("   1. 按组 ID 执行合并: go run cmd/merge-tracks/main.go -id <GroupID>")
	fmt.Println("   2. 按关键词执行合并: go run cmd/merge-tracks/main.go -name 五台山")
	fmt.Println("   3. 批量合并所有冲突: go run cmd/merge-tracks/main.go -all")
	fmt.Println("================================================================================")
}

func generateMarkdownReport(manifest *track.ConflictsManifest, outPath string) {
	var sb strings.Builder
	sb.WriteString("# 🧭 山河足迹 GPX 时空重叠与冲突比对报告\n\n")
	sb.WriteString(fmt.Sprintf("> **生成时间**: `%s`  \n", manifest.GeneratedAt))
	sb.WriteString(fmt.Sprintf("> **正式包目录**: `%s` (%d 个文件)  \n", manifest.ActiveDir, manifest.TotalActive))
	sb.WriteString(fmt.Sprintf("> **预备包目录**: `%s` (%d 个文件)  \n", manifest.PendingDir, manifest.TotalPending))
	sb.WriteString(fmt.Sprintf("> **发现重叠冲突组**: `%d` 组  \n\n", len(manifest.ConflictGroups)))

	sb.WriteString("## 📋 待合并冲突清单概览\n\n")
	sb.WriteString("| 组 ID | 正式包主轨迹 | 运动类型 | 时间跨度 | 关联预备包数 | 待注入心率 | 推荐操作 |\n")
	sb.WriteString("| :--- | :--- | :--- | :--- | :---: | :---: | :--- |\n")

	for _, grp := range manifest.ConflictGroups {
		hrStatus := "❌"
		if grp.TotalPendingHR {
			hrStatus = "✅ 可注入"
		}
		sb.WriteString(fmt.Sprintf("| `%s` | `%s` | `%s` | %s ~ %s | %d 个 | %s | `%s` |\n",
			grp.GroupID, grp.ActiveFilename, grp.ActiveActivity, grp.ActiveStart, grp.ActiveEnd, len(grp.PendingItems), hrStatus, grp.SuggestAction))
	}

	sb.WriteString("\n---\n\n## 🔍 详细冲突组与子分段对照\n\n")

	for i, grp := range manifest.ConflictGroups {
		sb.WriteString(fmt.Sprintf("### %d. 组 ID: `%s`\n\n", i+1, grp.GroupID))
		sb.WriteString(fmt.Sprintf("- **正式包文件**: `%s`\n", grp.ActiveFilename))
		sb.WriteString(fmt.Sprintf("- **时间范围**: `%s` 至 `%s` (原始点数: `%d`)\n", grp.ActiveStart, grp.ActiveEnd, grp.ActivePoints))
		sb.WriteString(fmt.Sprintf("- **推荐合并指令**: `go run cmd/merge-tracks/main.go -id %s`\n\n", grp.GroupID))
		sb.WriteString("**待合并预备包分段列表**:\n\n")
		sb.WriteString("| 预备包文件名 | 冲突类型 | 重合时长 | 重叠比例 | 点数 | 心率数据 |\n")
		sb.WriteString("| :--- | :--- | :---: | :---: | :---: | :--- |\n")

		for _, item := range grp.PendingItems {
			hrInfo := "无"
			if item.PendingHasHR {
				hrInfo = fmt.Sprintf("均 %d / 峰 %d bpm", item.PendingAvgHR, item.PendingMaxHR)
			}
			sb.WriteString(fmt.Sprintf("| `%s` | `%s` | %ds | %.1f%% | %d | %s |\n",
				item.PendingFilename, item.ConflictType, item.OverlapDuration, item.OverlapRatio*100, item.PendingPoints, hrInfo))
		}
		sb.WriteString("\n")
	}

	_ = os.WriteFile(outPath, []byte(sb.String()), 0644)
}
