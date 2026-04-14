#!/bin/zsh

# 编译 Go 项目
go build -o  ./shell/bin/photograph-management  cmd/admin/main.go
go build -o  ./shell/bin/site-preview  cmd/static/main.go

# 安装代理服务
cp ./shell/launch/com.vincent.photograph-management.job.plist ~/Library/LaunchAgents/
cp ./shell/launch/com.vincent.site-preview.job.plist ~/Library/LaunchAgents/
