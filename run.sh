#!/bin/zsh

# Check if exiftool is installed
if ! command -v exiftool &> /dev/null; then
    echo "exiftool could not be found"
    echo "Installing exiftool using Homebrew..."
    if command -v brew &> /dev/null; then
        brew install exiftool
    else
        echo "Homebrew is not installed. Please install Homebrew or install exiftool manually."
        exit 1
    fi
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)/shell/script"

case "$1" in
  init)
    sh "$SCRIPT_DIR/build_photograph-management_launchctl.sh"
    ;;
  start)
    go run ./cmd/build-photography-assets
    sh "$SCRIPT_DIR/start_photograph-management.sh"
    ;;
  stop)
    sh "$SCRIPT_DIR/stop_photograph-management.sh"
    ;;
  update)
    go run cmd/update-photos/main.go
    ;;
  restart)
    go run ./cmd/build-photography-assets
    sh "$SCRIPT_DIR/stop_photograph-management.sh"
    sh "$SCRIPT_DIR/build_photograph-management_launchctl.sh"
    sh "$SCRIPT_DIR/start_photograph-management.sh"
    ;;
  *)
    echo "用法: $0 {init|start|stop|update|restart}"
    echo "  init   初始化并安装 admin + 静态预览的 LaunchAgent"
    echo "  start  同时启动照片管理后台(:3002)和本地博客预览(:3000)"
    echo "  stop   停止上述两个本地服务"
    echo "  update 运行照片更新"
    exit 1
    ;;
esac
