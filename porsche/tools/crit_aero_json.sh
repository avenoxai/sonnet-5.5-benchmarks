#!/bin/bash
# usage: crit_aero_json.sh name "url params" 'camjson' [extra eval js]
cd /Users/avenox/Desktop/sonnet/porsche
NAME=$1; PARAMS=$2; CAM=$3; EX=${4:-0}; W=${5:-1600}; H=${6:-900}
JS="(async()=>{ $EX; await new Promise(r=>setTimeout(r,2500)); await PG_APP.setCamera($CAM); return 1})()"
node tools/shot.js --url "index.html?shot=1${PARAMS}" --out shots/crit_aero_authenticity_$NAME.png --w $W --h $H --eval "$JS" 2>&1 | grep -v "^\[console.log\]"
