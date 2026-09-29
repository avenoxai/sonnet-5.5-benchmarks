#!/bin/bash
n=$1; extra=$2
for spec in "wf:-90,4,2.6,1.23,0.45,-0.9" "wr:-90,4,2.8,-1.23,0.5,-0.9" "wf3:-50,10,3.0,1.2,0.5,-0.7" "wr3:-130,10,3.2,-1.2,0.5,-0.7"; do
  IFS=: read -r cn cv <<< "$spec"; bash tools/body_cam.sh ${n}_$cn "$cv" "$extra" >/dev/null
done
python3 tools/contact_sheet.py shots/body_${n}_wh.png 2 1000 shots/body_${n}_wf.png shots/body_${n}_wr.png shots/body_${n}_wf3.png shots/body_${n}_wr3.png
