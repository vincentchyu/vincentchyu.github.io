#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
山河足迹增量轨迹全自动化闭环调度中枢 (Incremental Track Pipeline Dispatcher)
全链路闭环: 从 iPhone 导出.zip -> apple_health_export 增量心率对齐 -> Go internal/track 逆地理规范命名归档 -> 前端足迹刷新

严格遵循【单一职责、高内聚抽象、全链路复用】原则:
1. 100% 复用 apple_health_export 核心库进行增量感知与双层心率流式对齐 (专注健康数据提取)
2. 100% 复用 internal/track (photools 全内存 3D KD-Tree) 统一进行高精逆地理编码与语义规范命名
3. 统一通过 cmd/update-tracks --import-dir 完成安全去重归档、分片索引生成与摄影时空对齐
"""

import os
import sys
import glob
import time
import argparse
import subprocess
from typing import Optional

# 1. 动态引入 apple_health_export 核心能力库
HEALTH_EXPORT_DIR = os.path.expanduser("~/Developer/code/python_code/apple_health_export")
if not os.path.exists(HEALTH_EXPORT_DIR):
    print(f"❌ 找不到 apple_health_export 核心库目录: {HEALTH_EXPORT_DIR}")
    sys.exit(1)

sys.path.insert(0, HEALTH_EXPORT_DIR)
try:
    from running import HealthMerger, CacheManager
except ImportError as e:
    print(f"❌ 无法从 apple_health_export 导入核心模块: {e}")
    sys.exit(1)

# 常量配置
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TARGET_GPX_DIR = os.path.expanduser("~/.config/gpx")
GO_BIN = "/Users/vincent/.asdf/installs/golang/1.27.1/go/bin/go"
if not os.path.exists(GO_BIN):
    GO_BIN = "go"


def find_input_zip(specified_path: Optional[str] = None) -> Optional[str]:
    """智能查找可用的 Apple Health 导出数据包 (按优先级探测)"""
    if specified_path:
        p = os.path.abspath(os.path.expanduser(specified_path))
        if os.path.isfile(p):
            return p
        print(f"⚠️ 指定的文件不存在: {p}")

    search_candidates = [
        os.path.expanduser("~/Downloads/导出.zip"),
        os.path.expanduser("~/Downloads/export.zip"),
        os.path.expanduser("~/Desktop/导出.zip"),
        os.path.expanduser("~/Desktop/export.zip"),
        os.path.join(HEALTH_EXPORT_DIR, "导出.zip"),
        os.path.join(HEALTH_EXPORT_DIR, "export.zip"),
    ]

    for p in search_candidates:
        if os.path.isfile(p):
            return p

    # 兜底模糊匹配 ~/Downloads/*export*.zip 或 *导出*.zip
    dl_dir = os.path.expanduser("~/Downloads")
    if os.path.isdir(dl_dir):
        zips = glob.glob(os.path.join(dl_dir, "*导出*.zip")) + glob.glob(os.path.join(dl_dir, "*export*.zip"))
        if zips:
            zips.sort(key=lambda x: os.path.getmtime(x), reverse=True)
            return zips[0]

    return None


def main():
    parser = argparse.ArgumentParser(description="山河足迹增量轨迹全自动化闭环调度中枢")
    parser.add_argument("zip", nargs="?", default=None, help="自定义指定的 导出.zip 路径 (选填，不填则自动探测)")
    parser.add_argument("--force", action="store_true", help="强制全量重新对齐所有健康数据 (忽略缓存)")
    parser.add_argument("--dry-run", action="store_true", help="演练模式 (仅流式对齐，不触发 Go 归档入库与流水线)")
    args = parser.parse_args()

    print("================================================================================")
    print("🚀 山河足迹增量轨迹全自动化闭环流水线 (Incremental Track Pipeline)")
    print("================================================================================")
    print(f"🏠 站点根目录: {REPO_ROOT}")
    print(f"📂 目标归档目录: {TARGET_GPX_DIR}")

    # 阶段 1: 智能探测输入 ZIP
    zip_path = find_input_zip(args.zip)
    if not zip_path:
        print("❌ 未在常用路径找到 Apple Health 导出数据包 (导出.zip 或 export.zip)！")
        print("👉 请从 iPhone 健康 App 导出数据，并存入 ~/Downloads/ 目录后重试，")
        print("   或在命令行直接传入路径: ./run.sh synct /path/to/导出.zip")
        sys.exit(1)

    print(f"📦 成功锁定数据包: {zip_path} ({os.path.getsize(zip_path)/(1024*1024):.1f} MB)")
    print("--------------------------------------------------------------------------------")

    # 阶段 2: 100% 复用 apple_health_export 核心流式对齐引擎
    print("[阶段 1/3] 启动 apple_health_export 增量心率对齐中枢 (流式提取 & 缓存比对)...")
    out_routes_dir = os.path.join(HEALTH_EXPORT_DIR, "workout-routes-with-hr")
    os.makedirs(out_routes_dir, exist_ok=True)

    cache_mgr = CacheManager(out_routes_dir)
    before_keys = set(cache_mgr.data.keys())

    merger = HealthMerger(HEALTH_EXPORT_DIR, out_routes_dir)
    t0 = time.time()
    # 执行增量合并 (原生支持忽略已处理历史轨迹)
    merger.run(force=args.force, custom_src=zip_path)
    after_keys = set(cache_mgr._load().keys())

    new_fnames = after_keys - before_keys
    print(f"⏱️  apple_health_export 处理耗时: {time.time() - t0:.2f} 秒")

    if not new_fnames and not args.force:
        print("\n💡 提示: 未检测到新的体能训练增量 (所有轨迹在历史缓存中均已处理完成)。")
        print("   全站数据已是最新，无需执行后续归档与渲染更新。")
        return

    print(f"\n🎯 本次成功捕获全新体能训练增量: {len(new_fnames)} 条！")
    for f in sorted(list(new_fnames)):
        print(f"  • {f}")
    print("--------------------------------------------------------------------------------")

    # 阶段 3: 演练模式提前拦截
    if args.dry_run:
        print("💡 当前为演练模式 (--dry-run)，已成功生成带心率轨迹于临时目录，跳过 Go 归档与流水线。")
        return

    # 阶段 4: 100% 复用 internal/track 逆地理编码中枢与归档流水线
    print("[阶段 2/3] 交棒 Go 核心流水线 (cmd/update-tracks --import-dir)...")
    print("           包含: 全内存 3D KD-Tree 逆地理编码、规范命名归档、高程滤波、摄影对齐\n")

    cmd = [GO_BIN, "run", "cmd/update-tracks/main.go", "--import-dir", out_routes_dir]
    res = subprocess.run(cmd, cwd=REPO_ROOT)
    if res.returncode != 0:
        print("❌ cmd/update-tracks 执行失败，请检查上方日志。")
        sys.exit(res.returncode)

    # 阶段 5: 最终大闭环汇报
    print("\n================================================================================")
    print("🎉 恭喜！全链路增量轨迹全自动闭环更新大获成功！")
    print(f"   • 本次导入增量轨迹: {len(new_fnames)} 条")
    print("   • 逆地理编码与语义命名: 100% 由 internal/track (3D KD-Tree) 统筹完成")
    print("   • 前端数据已自动刷新: web/tracks/data/manifest.json & tracks/*.json")
    print("   • 若本地博客正在运行 (http://localhost:3000)，直接刷新页面即可点亮最新足迹！")
    print("================================================================================\n")


if __name__ == "__main__":
    main()
