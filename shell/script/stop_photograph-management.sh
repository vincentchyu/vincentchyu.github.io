#!/bin/zsh

launchctl stop  com.vincent.photograph-management.job
launchctl remove  com.vincent.photograph-management.job
launchctl stop  com.vincent.site-preview.job
launchctl remove  com.vincent.site-preview.job
rm -f ~/Library/LaunchAgents/com.vincent.photograph-management.job.plist
rm -f ~/Library/LaunchAgents/com.vincent.site-preview.job.plist
rm -f ./shell/bin/photograph-management
rm -f ./shell/bin/site-preview


