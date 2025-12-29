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
    sh "$SCRIPT_DIR/start_photograph-management.sh"
    ;;
  stop)
    sh "$SCRIPT_DIR/stop_photograph-management.sh"
    ;;
  update)
    go run cmd/update-photos/main.go
    ;;
  *)
    echo "用法: $0 {init|start|stop|update}"
    exit 1
    ;;
esac