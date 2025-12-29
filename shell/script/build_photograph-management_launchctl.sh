#!/bin/zsh

# 编译 Go 项目
go build -o  ./shell/bin/photograph-management  cmd/admin/main.go

# 启动代理服务
sudo cp ./shell/launch/com.vincent.photograph-management.job.plist ~/Library/LaunchAgents/