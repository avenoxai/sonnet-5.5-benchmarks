#!/bin/bash
n=$1; extra=$2
for spec in "f1:-30,14,3.6,1.5,0.6,0" "f2:-70,10,3.6,1.3,0.6,0" "f3:-8,6,4.0,1.5,0.6,0" "f4:-55,30,3.6,1.3,0.6,0"; do
  IFS=: read -r cn cv <<< "$spec"; bash tools/body_cam.sh ${n}_$cn "$cv" "$extra" >/dev/null
done
python3 tools/contact_sheet.py shots/body_${n}_fr.png 2 1000 shots/body_${n}_f1.png shots/body_${n}_f2.png shots/body_${n}_f3.png shots/body_${n}_f4.png
