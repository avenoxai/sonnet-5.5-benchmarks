#!/bin/bash
# usage: tools/body_sheet.sh name [extra url params] [cams]   -> shots/body_<name>_sheet.png (contact sheet of the cams)
n=$1; extra=$2; cams=${3:-front34,side,rear34,front,top,rear}
node tools/shot.js --url "index.html?shot=1&mods=body,wheels&markers=0${extra}" --out shots/body_${n}.png --w 1200 --h 675 --cams $cams 2>&1 | grep -E "error|warn|Error"
files=""; for c in ${cams//,/ }; do files="$files shots/body_${n}-$c.png"; done
python3 tools/contact_sheet.py shots/body_${n}_sheet.png 3 800 $files
