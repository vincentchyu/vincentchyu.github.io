#!/bin/zsh

launchctl stop  com.vincent.photograph-management.job
launchctl remove  com.vincent.photograph-management.job
rm -f ~/Library/LaunchAgents/com.vincent.photograph-management.job.plist
rm -f ./shell/bin/photograph-management



