#!/bin/bash

# ==============================================================================
# 用法:
#   1. 预览模式（只打印不修改）:
#      ./rename_gpx.sh /path/to/gpx_folder --dry-run
#      例如: ./rename_gpx.sh ~/.config/gpx --dry-run
#
#   2. 正式执行重命名:
#      ./rename_gpx.sh /path/to/gpx_folder
#      例如: ./rename_gpx.sh ~/.config/gpx
# ==============================================================================

TARGET_DIR="${1:-.}"
DRY_RUN=false

if [[ "$1" == "--dry-run" || "$2" == "--dry-run" ]]; then
    DRY_RUN=true
fi

# 展开波浪号 ~ 路径
eval TARGET_DIR="$TARGET_DIR"

# 检查目标目录是否存在
if [[ ! -d "$TARGET_DIR" ]]; then
    echo "❌ 目录不存在: $TARGET_DIR"
    exit 1
fi

echo "📂 正在扫描目录: $TARGET_DIR"
if [ "$DRY_RUN" = true ]; then
    echo "🔍 当前为 [预览模式]（不会修改实际文件名）"
fi
echo "--------------------------------------------------------"

# 运动类型英文到中文的转换函数
get_sport_name() {
    local sport=$(echo "$1" | tr '[:upper:]' '[:lower:]')
    case "$sport" in
        walking)  echo "行走" ;;
        running|run)  echo "跑步" ;;
        hiking|hike)   echo "徒步" ;;
        cycling|biking|ride) echo "骑行" ;;
        swimming|swim) echo "游泳" ;;
        *)        echo "$1" ;; # 未匹配到的运动类型保留原名
    esac
}

# 根据小时、分钟和 am/pm 计算时间段
get_time_period() {
    local hour=$1
    local min=$2
    local ampm=$(echo "$3" | tr '[:upper:]' '[:lower:]')

    # 转换为 24 小时制
    local hour24=$hour
    if [[ "$ampm" == "pm" && "$hour" -ne 12 ]]; then
        hour24=$((hour + 12))
    elif [[ "$ampm" == "am" && "$hour" -eq 12 ]]; then
        hour24=0
    fi

    # 根据 24 小时制区间判断时间段
    if (( hour24 >= 0 && hour24 < 5 )); then
        echo "凌晨"
    elif (( hour24 >= 5 && hour24 < 9 )); then
        echo "早晨"
    elif (( hour24 >= 9 && hour24 < 12 )); then
        echo "上午"
    elif (( hour24 >= 12 && hour24 < 13 )); then
        echo "中午"
    elif (( hour24 >= 13 && hour24 < 18 )); then
        echo "下午"
    elif (( hour24 >= 18 && hour24 < 20 )); then
        echo "傍晚"
    else
        echo "晚上"
    fi
}

count=0

# 遍历目标目录下的 .gpx 文件
for file_path in "$TARGET_DIR"/*.gpx; do
    # 如果没有匹配的文件则跳出
    [[ -e "$file_path" ]] || continue

    filename=$(basename "$file_path")

    # 正则匹配格式: 前缀-时_分(am|pm)-日期.gpx
    # 示例: walking-中国-广东-5_32pm-20250925.gpx
    if [[ "$filename" =~ ^(.+)-([0-9]{1,2})_([0-9]{2})(am|pm|AM|PM)-([0-9]{8}\.gpx)$ ]]; then
        prefix="${BASH_REMATCH[1]}"      # 例如: walking-中国-广东
        hour="${BASH_REMATCH[2]}"        # 例如: 5
        min="${BASH_REMATCH[3]}"         # 例如: 32
        ampm="${BASH_REMATCH[4]}"        # 例如: pm
        date_ext="${BASH_REMATCH[5]}"    # 例如: 20250925.gpx

        # 从前缀中提取第一段作为运动类型 (如 walking)
        sport_en="${prefix%%-*}"
        sport_cn=$(get_sport_name "$sport_en")
        time_period=$(get_time_period "$hour" "$min" "$ampm")

        # 组合替换内容: 下午行走
        replacement="${time_period}${sport_cn}"

        # 拼接新文件名: walking-中国-广东-下午行走-20250925.gpx
        new_filename="${prefix}-${replacement}-${date_ext}"
        new_file_path="$(dirname "$file_path")/$new_filename"

        if [ "$filename" != "$new_filename" ]; then
            if [ "$DRY_RUN" = true ]; then
                echo "📝 [预览] $filename"
                echo "   ➡️  $new_filename"
            else
                mv "$file_path" "$new_file_path"
                echo "✅ [已重命名] $filename -> $new_filename"
            fi
            ((count++))
        fi
    fi
done

echo "--------------------------------------------------------"
echo "🎉 处理完成！共匹配并处理 $count 个文件。"
