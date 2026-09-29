#!/bin/bash
# usage: tools/body_sec.sh name xs [zs]
node tools/body_sections.js --url "index.html?shot=1&mods=body&markers=0" --xs ${2:-2.1,1.93,1.6,1.2285,0.7,-0.2,-0.9,-1.2285,-1.8,-2.2} --zs ${3:-0,0.3,0.6,0.8,0.9} --out shots/body_$1.png 2>&1 | tail -3
