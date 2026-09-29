#!/bin/bash
# usage: tools/body_close.sh name [extra url params]  -> close views sheet
n=$1; extra=$2
for spec in "r34:-145,14,4.6,-1.2,0.65,0" "f34:-35,10,4.6,1.2,0.6,0" "side:-90,2,7.5,0,0.65,0" "rear:180,8,5,-1.5,0.7,0"; do
  IFS=: read -r cn cv <<< "$spec"; bash tools/body_cam.sh ${n}_$cn "$cv" "$extra" >/dev/null
done
python3 tools/contact_sheet.py shots/body_${n}_close.png 2 1000 shots/body_${n}_f34.png shots/body_${n}_r34.png shots/body_${n}_side.png shots/body_${n}_rear.png
