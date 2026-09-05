package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/vincentchyu/vincentchyu.github.io/internal/track"
)

func main() {
	homeDir, _ := os.UserHomeDir()
	defaultActive := filepath.Join(homeDir, ".config", "gpx")
	defaultArchive := filepath.Join(homeDir, ".config", "gpx", "archive")

	dirPath := flag.String("dir", defaultActive, "Directory containing GPX files")
	pattern := flag.String("pattern", "", "File pattern or keyword to match (e.g. *喀拉峻* or 喀拉峻)")
	title := flag.String("title", "", "Title for the concatenated track (e.g. 喀拉峻大环线)")
	outFilename := flag.String("out", "", "Output GPX filename (e.g. hiking-中国-新疆-喀拉峻大环线-20260608.gpx)")
	doArchive := flag.Bool("archive", true, "Archive input segment files to ~/.config/gpx/archive/ after merge")
	archiveDir := flag.String("archive-dir", defaultArchive, "Archive directory path")
	dryRun := flag.Bool("dry-run", false, "Simulate concatenation without writing files")

	flag.Parse()

	// 1. 获取匹配的文件列表
	var matchedFiles []string
	if *pattern != "" {
		if strings.Contains(*pattern, "*") {
			matches, _ := filepath.Glob(filepath.Join(*dirPath, *pattern))
			matchedFiles = matches
		} else {
			all, _ := filepath.Glob(filepath.Join(*dirPath, "*.gpx"))
			for _, f := range all {
				if strings.Contains(filepath.Base(f), *pattern) {
					matchedFiles = append(matchedFiles, f)
				}
			}
		}
	} else if len(flag.Args()) > 0 {
		for _, arg := range flag.Args() {
			matches, _ := filepath.Glob(arg)
			if len(matches) > 0 {
				matchedFiles = append(matchedFiles, matches...)
			} else if _, err := os.Stat(arg); err == nil {
				matchedFiles = append(matchedFiles, arg)
			}
		}
	}

	if len(matchedFiles) < 2 {
		fmt.Println("⚠️ 请指定至少 2 个需要首尾串联的 GPX 文件:")
		fmt.Println("   - 使用 -pattern <Keyword> (例如: -pattern 喀拉峻)")
		fmt.Println("   - 使用 -pattern \"*喀拉峻*.gpx\"")
		fmt.Println("   - 或直接在命令行末尾列出文件: go run cmd/concat-tracks/main.go D1.gpx D2.gpx D3.gpx")
		os.Exit(1)
	}

	sort.Strings(matchedFiles)

	// 2. 确定输出标题与文件名
	outTitle := *title
	if outTitle == "" {
		firstBase := filepath.Base(matchedFiles[0])
		outTitle = strings.TrimSuffix(firstBase, ".gpx")
		if strings.Contains(outTitle, "-") {
			parts := strings.Split(outTitle, "-")
			if len(parts) >= 4 {
				outTitle = parts[len(parts)-2]
			}
		}
		outTitle = strings.ReplaceAll(outTitle, "D1", "")
		outTitle = strings.ReplaceAll(outTitle, "D2", "")
		outTitle = strings.ReplaceAll(outTitle, "D3", "")
		outTitle = strings.TrimSpace(outTitle) + "大环线"
	}

	outFile := *outFilename
	if outFile == "" {
		firstBase := filepath.Base(matchedFiles[0])
		clean := strings.TrimSuffix(firstBase, ".gpx")
		parts := strings.Split(clean, "-")
		if len(parts) >= 4 {
			// hiking-中国-新疆-喀拉峻大环线-20260608.gpx
			outFile = fmt.Sprintf("%s-%s-%s-%s-%s.gpx", parts[0], parts[1], parts[2], outTitle, parts[len(parts)-1])
		} else {
			outFile = fmt.Sprintf("%s-merged.gpx", clean)
		}
	}

	var fullOutPath string
	if filepath.IsAbs(outFile) {
		fullOutPath = outFile
	} else {
		fullOutPath = filepath.Join(*dirPath, outFile)
	}

	fmt.Println("================================================================================")
	fmt.Printf("🧩 即将按天数/时序首尾相连合并 %d 个轨迹分段:\n", len(matchedFiles))
	for i, f := range matchedFiles {
		fmt.Printf("   [%d] %s\n", i+1, filepath.Base(f))
	}
	fmt.Printf("🎯 合并后输出文件: \033[1;32m%s\033[0m\n", filepath.Base(fullOutPath))
	fmt.Printf("🏷️ 路线大标题: \033[1;36m%s\033[0m\n", outTitle)
	if *dryRun {
		fmt.Println("⚠️ [演练模式 Dry-Run] 不会写入文件")
	}
	fmt.Println("================================================================================")

	if *dryRun {
		return
	}

	res, err := track.ConcatGPXTracks(matchedFiles, outTitle, fullOutPath)
	if err != nil {
		fmt.Printf("❌ 串联失败: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("✅ 串联合并成功!")
	fmt.Printf("   - 各分段时序:\n")
	for i, seg := range res.Segments {
		fmt.Printf("     D%d: %s | %s ~ %s | %.2f km (%d 点)\n",
			i+1, seg.Filename,
			seg.StartTime.Local().Format("2006-01-02 15:04"),
			seg.EndTime.Local().Format("15:04"),
			seg.DistanceKm, len(seg.Points))
	}
	fmt.Printf("   - 总点数: \033[1;32m%d\033[0m 点\n", res.TotalPoints)
	fmt.Printf("   - 总里程: \033[1;32m%.2f km\033[0m\n", res.TotalDistanceKm)
	fmt.Printf("   - 总爬升: \033[1;32m%.0f m\033[0m\n", res.TotalElevationM)
	if res.AvgHR > 0 {
		fmt.Printf("   - 心率数据: 均心率 %d bpm | 最高 %d bpm\n", res.AvgHR, res.MaxHR)
	}
	fmt.Printf("   - 全程时间: %s ~ %s\n",
		res.StartTime.Local().Format("2006-01-02 15:04"),
		res.EndTime.Local().Format("2006-01-02 15:04"))

	// 归档输入分段
	if *doArchive {
		_ = os.MkdirAll(*archiveDir, 0755)
		fmt.Println("\n📦 归档旧分段文件 (避免全站里程双重统计):")
		for _, f := range matchedFiles {
			// 如果输出文件名正好与某个分段重名，跳过
			if f == fullOutPath {
				continue
			}
			dest := filepath.Join(*archiveDir, filepath.Base(f))
			if err := os.Rename(f, dest); err == nil {
				fmt.Printf("   ✓ 已归档: %s ──► archive/\n", filepath.Base(f))
			}
		}
	}

	fmt.Println("\n================================================================================")
	fmt.Println("🎉 大环线轨迹生成完毕! 请运行 `go run cmd/update-tracks/main.go` 更新全站数据。")
	fmt.Println("================================================================================")
}
