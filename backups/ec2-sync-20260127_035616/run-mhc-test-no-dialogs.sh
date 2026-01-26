#!/bin/bash
# Disable xdg-open and protocol handler prompts
export DISPLAY=:1
export USE_HEADED_BROWSER=true
export HEADLESS=false
export GIO_LAUNCHED_DESKTOP_FILE_PID=9911
export GIO_LAUNCHED_DESKTOP_FILE=/dev/null

cd ~/Baselrpacrm
node src/examples/test-mhc-form-filling-75434.js
