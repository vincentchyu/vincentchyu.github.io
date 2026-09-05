#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Apple Health 心率高精度回填与同步工具 (用于安全恢复 ~/.config/gpx 中的历史断层心率)
基于 apple_health_export 项目的地面真值流式分发与双层对齐引擎重构成果。
"""

import os
import sys
import glob
import time
import shutil
import tarfile
import zipfile
import argparse
import xml.etree.ElementTree as ET
from datetime import datetime
from typing import List, Dict, Any, Tuple

# 引入 apple_health_export 核心算法库
HEALTH_EXPORT_PATH = os.path.expanduser("~/Developer/code/python_code/apple_health_export")
if os.path.exists(HEALTH_EXPORT_PATH):
    sys.path.insert(0, HEALTH_EXPORT_PATH)
    from running import HealthMerger, GpxProcessor
    from running.merger import decode_zip_name, epoch_to_local_str
else:
    print(f"❌ 找不到 apple_health_export 项目路径: {HEALTH_EXPORT_PATH}")
    sys.exit(1)


def count_existing_hr(root: ET.Element) -> Tuple[int, int]:
    """统计 GPX 根节点中现存的轨迹点总数与包含心率的点数"""
    trkpts = root.findall(".//{http://www.topografix.com/GPX/1/1}trkpt")
    total_pts = len(trkpts)
    hr_pts = 0
    for pt in trkpts:
        hr = pt.find(".//{http://www.garmin.com/xmlschemas/TrackPointExtension/v1}hr")
        if hr is not None and hr.text and hr.text.strip():
            try:
                val = int(hr.text.strip())
                if val > 0:
                    hr_pts += 1
            except ValueError:
                pass
    return total_pts, hr_pts


def create_backup(gpx_dir: str) -> str:
    """为目标 GPX 目录创建安全压缩快照"""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_tar = os.path.expanduser(f"~/.config/gpx_backup_{ts}.tar.gz")
    print(f"📦 正在创建目标库安全备份: {backup_tar} ...")
    with tarfile.open(backup_tar, "w:gz") as tar:
        tar.add(gpx_dir, arcname=os.path.basename(gpx_dir))
    print(f"✅ 备份创建成功! 大小: {os.path.getsize(backup_tar)/(1024*1024):.2f} MB\n")
    return backup_tar


def main():
    parser = argparse.ArgumentParser(description="Apple Health 心率安全回填工具 (无损更新 ~/.config/gpx)")
    parser.add_argument("--gpx-dir", default=os.path.expanduser("~/.config/gpx"), help="目标 GPX 归档目录 (默认 ~/.config/gpx)")
    parser.add_argument("--health-dir", default=HEALTH_EXPORT_PATH, help="apple_health_export 项目目录")
    parser.add_argument("--dry-run", action="store_true", help="演练模式：仅计算并输出前后覆盖率对比，不修改实际文件")
    parser.add_argument("--no-backup", action="store_true", help="跳过自动备份")
    args = parser.parse_args()

    gpx_dir = os.path.abspath(args.gpx_dir)
    health_dir = os.path.abspath(args.health_dir)

    print("================================================================================")
    print("🧭 Apple Health 心率无损回填与精准对齐同步工具")
    print("================================================================================")
    print(f"📂 目标 GPX 目录: {gpx_dir}")
    print(f"🏥 健康数据来源: {health_dir}")
    print(f"⚙️ 运行模式: {'【演练模式 (DRY RUN - 不写盘)】' if args.dry_run else '【正式执行 (写入恢复目标文件)】'}")
    print("--------------------------------------------------------------------------------")

    # 1. 寻找 导出.zip
    zip_path = os.path.join(health_dir, "导出.zip")
    if not os.path.exists(zip_path):
        zip_path = os.path.join(health_dir, "export.zip")
    if not os.path.exists(zip_path):
        zips = glob.glob(os.path.join(health_dir, "*.zip"))
        if zips:
            zip_path = zips[0]
        else:
            print(f"❌ 在 {health_dir} 未找到 导出.zip 或 export.zip")
            sys.exit(1)

    print(f"📦 发现健康数据包: {zip_path} ({os.path.getsize(zip_path)/(1024*1024):.1f} MB)")

    # 2. 扫描目标 GPX 目录并解析点位时间跨度
    gpx_files = sorted(glob.glob(os.path.join(gpx_dir, "*.gpx")))
    print(f"🔍 扫描到目标 GPX 轨迹: {len(gpx_files)} 个")

    pending_list: List[Dict[str, Any]] = []
    skipped_files = 0

    print("⏳ 正在分析轨迹起止时间跨度与现有心率基线...")
    for idx, fpath in enumerate(gpx_files):
        try:
            tree = ET.parse(fpath)
            root = tree.getroot()
            timestamps = GpxProcessor.extract_trkpt_times(root)
            if len(timestamps) < 2:
                skipped_files += 1
                continue

            st = min(timestamps)
            et = max(timestamps)
            total_pts, old_hr_pts = count_existing_hr(root)

            pending_list.append({
                "id": idx,
                "filepath": fpath,
                "filename": os.path.basename(fpath),
                "start": st - 60,
                "end": et + 60,
                "real_start": st,
                "real_end": et,
                "timestamps": timestamps,
                "total_pts": total_pts,
                "old_hr_pts": old_hr_pts,
                "root": root,
                "hr_records": [],
                "seen_hr": set()
            })
        except Exception as e:
            print(f"  ⚠️ 解析 {os.path.basename(fpath)} 失败: {e}")
            skipped_files += 1

    print(f"✅ 成功加载 {len(pending_list)} 条有效轨迹 (跳过点位不足或格式异常: {skipped_files} 个)\n")

    if not pending_list:
        print("未发现待处理的轨迹文件。")
        return

    # 3. 自动安全备份
    if not args.dry_run and not args.no_backup:
        create_backup(gpx_dir)

    # 4. 流式扫描 Apple Health 原始心率 (单遍高效流式 iterparse)
    merger = HealthMerger(health_dir)
    with zipfile.ZipFile(zip_path, "r") as zf:
        xml_member = None
        for raw in zf.namelist():
            dec = decode_zip_name(raw)
            if dec.endswith("导出.xml") or dec.endswith("export.xml"):
                xml_member = raw
                break
            if dec.endswith(".xml") and not dec.endswith("export_cda.xml"):
                xml_member = raw

        if not xml_member:
            print("❌ 未在 ZIP 包内找到 导出.xml / export.xml")
            sys.exit(1)

        print(f"🚀 正在流式扫描 ZIP 内的 {xml_member} ...")
        t_start = time.time()
        with zf.open(xml_member) as xml_file:
            scanned_cnt, matched_cnt = merger._stream_dispatch_heart_rates(xml_file, pending_list)

    # 5. 执行双层心率对齐与评估
    print("--------------------------------------------------------------------------------")
    print("📊 正在执行双层心率对齐计算并比对前后覆盖率...")

    improved_files = 0
    total_new_hr_pts = 0
    total_old_hr_pts = 0
    total_all_pts = 0

    top_improvements = []

    for meta in pending_list:
        timestamps = meta["timestamps"]
        old_hr = meta["old_hr_pts"]
        total_pts = meta["total_pts"]

        aligned_hr = GpxProcessor.align_heart_rate(timestamps, meta["hr_records"])
        new_hr = sum(1 for h in aligned_hr if h is not None)

        total_old_hr_pts += old_hr
        total_new_hr_pts += new_hr
        total_all_pts += total_pts

        diff_hr = new_hr - old_hr
        old_cov = (old_hr / total_pts * 100) if total_pts > 0 else 0
        new_cov = (new_hr / total_pts * 100) if total_pts > 0 else 0

        # 如果心率有显著增长或补充
        if diff_hr > 0:
            improved_files += 1
            top_improvements.append((diff_hr, old_cov, new_cov, meta["filename"], meta))

            if not args.dry_run:
                # 原位注入并保存
                GpxProcessor.inject_hr_and_save(meta["root"], meta["hr_records"], meta["filepath"])

    # 排序展示提升最大的样本
    top_improvements.sort(key=lambda x: x[0], reverse=True)

    print("\n🌟 显著修复提升的典型轨迹样本 TOP 10:")
    for diff, ocov, ncov, fn, _ in top_improvements[:10]:
        print(f"  • {fn:<42} | 覆盖率: {ocov:5.1f}% ➡️ \033[1;32m{ncov:5.1f}%\033[0m (净增 +{diff} 点)")

    print("\n================================================================================")
    print("📈 全库修复前后宏观对比总结 (Before vs After):")
    print(f"   - 扫描轨迹总数: {len(pending_list)} 条")
    print(f"   - 获得心率修复/提升的轨迹: {improved_files} 条")
    print(f"   - 修复前心率总点数: {total_old_hr_pts:,} / {total_all_pts:,} ({total_old_hr_pts/total_all_pts*100:.2f}%)")
    print(f"   - 修复后心率总点数: {total_new_hr_pts:,} / {total_all_pts:,} (\033[1;32m{total_new_hr_pts/total_all_pts*100:.2f}%\033[0m)")
    print(f"   - 全库心率净增加: +{total_new_hr_pts - total_old_hr_pts:,} 点")
    print("================================================================================")

    if args.dry_run:
        print("\n💡 当前为演练模式 (DRY RUN)，未对磁盘做任何修改。")
        print("   若确认效果满意，请移除 --dry-run 参数正式执行。")
    else:
        print("\n🎉 回填同步全部成功！目标 GPX 文件已更新完毕。")
        print("👉 下一步：请运行 `go run cmd/update-tracks/main.go` 全量刷新山河足迹前端元数据与分片！")


if __name__ == "__main__":
    main()
