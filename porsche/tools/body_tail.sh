#!/bin/bash
n=$1; extra=$2
for spec in "t1:-150,12,3.4,-2.0,0.65,0.2" "t2:-105,10,3.6,-1.6,0.7,0" "t3:150,25,3.6,-1.9,0.8,0" "t4:-120,14,4.5,-1.0,0.8,0"; do
  IFS=: read -r cn cv <<< "$spec"; bash tools/body_cam.sh ${n}_$cn "$cv" "$extra" >/dev/null
done
python3 tools/contact_sheet.py shots/body_${n}_tail.png 3 700 shots/body_${n}_t1.png shots/body_${n}_t2.png shots/body_${n}_t3.png shots/body_${n}_t4.png
