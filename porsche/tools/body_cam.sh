#!/bin/bash
# usage: tools/cam.sh name "az,el,dist,tx,ty,tz[,fov]" [extra url params]   -> shots/body_<name>.png
n=$1; IFS=',' read -r az el d tx ty tz fov <<< "$2"; fov=${fov:-32}
node tools/shot.js --url "index.html?shot=1&mods=body,wheels&markers=0${3}" --out shots/body_$n.png --w 1600 --h 900 --eval "PG_APP.setCamera({az:$az,el:$el,dist:$d,target:[$tx,$ty,$tz],fov:$fov}).then(()=>'ok')" 2>&1 | grep -E "error|wrote|warn|Error"
