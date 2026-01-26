#!/bin/bash
export DISPLAY=:1
export USE_HEADED_BROWSER=true
export HEADLESS=false
cd ~/Baselrpacrm
node src/examples/test-patient-78025-from-report.js
