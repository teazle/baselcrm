#!/bin/bash
export DISPLAY=:1
export USE_HEADED_BROWSER=true
export HEADLESS=false
cd ~/Baselrpacrm
node src/examples/test-mhc-form-filling-75434.js
