#!/bin/bash
# usage: crit_auth_cam.sh name "params" az el dist tx ty tz [drs] [w h fov] [extra-eval]
cd /Users/avenox/Desktop/sonnet/porsche
NAME=$1; PARAMS=$2; AZ=$3; EL=$4; D=$5; TX=$6; TY=$7; TZ=$8; DRS=${9:-0}; W=${10:-1600}; H=${11:-900}; FOV=${12:-30}; EX=${13:-}
JS="(async()=>{PG_APP.setState({drs:$DRS}); $EX await new Promise(r=>setTimeout(r,2500)); await PG_APP.setCamera({az:$AZ,el:$EL,dist:$D,target:[$TX,$TY,$TZ],fov:$FOV,limits:{min:0.2,max:20}}); return 1})()"
node tools/shot.js --url "index.html?shot=1${PARAMS}" --out shots/crit_aero_authenticity_$NAME.png --w $W --h $H --eval "$JS" 2>&1 | grep -v "^\[console.log\]" | grep -v "^ready\|wrote\|eval"
