#!/bin/bash
# usage: wait.sh <workflow-run-id> [max_seconds]  — returns when a new agent finished or time is up; prints status
RID=$1; MAX=${2:-570}
J=/Users/avenox/.claude/projects/-Users-avenox-Desktop-sonnet-porsche/dc1010f2-4650-42f6-aaac-bba070fc10d6/subagents/workflows/$RID/journal.jsonl
STATE=/tmp/pg_wait2_$RID.count
count() { local c; c=$(grep -c '"type":"result"' "$J" 2>/dev/null); c=$(echo "$c" | head -1 | tr -dc '0-9'); echo "${c:-0}"; }
prev=$(cat $STATE 2>/dev/null | tr -dc '0-9'); prev=${prev:-0}
end=$((SECONDS+MAX))
while [ $SECONDS -lt $end ]; do
  n=$(count)
  if [ "$n" -gt "$prev" ]; then break; fi
  sleep 15
done
count > $STATE
node -e "
const fs=require('fs');const L=fs.readFileSync('$J','utf8').trim().split('\n').map(l=>JSON.parse(l));
const st={};for(const e of L){if(e.type==='started')st[e.agentId]=e.label;}
const done=L.filter(e=>e.type==='result').map(e=>st[e.agentId]);
const running=Object.keys(st).filter(id=>!L.some(e=>e.type==='result'&&e.agentId===id)).map(id=>st[id]);
console.log('done('+done.length+'): '+done.join(', '));
console.log('running: '+running.join(', '));
"
date
