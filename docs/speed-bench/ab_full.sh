#!/bin/bash
# The whole one-launch chain on the speed-test copy of the F5 (placement, build, quality render, AI finish with a fake gateway), twice:
#   old = every speed change switched off by its environment variable (what the pipeline did on 20 Nov)
#   new = the defaults
# usage: ab_full.sh old|new      Results in $RES/full-<label>/ : e2e.log, sampler.csv, a copy of the render/AI files' times
set -u
WT=/media/jackhammer/DATA/Linux-Work/Projects/roomia-speed
D=/media/jackhammer/DATA/Linux-Work/roomia-speed-test
P=$D/projects/BlocBF5Speed000000001
LABEL=$1; OUT=$D/results/full-$LABEL; mkdir -p $OUT
cd $WT
[ "$(systemctl --user is-active roomia-studio)" = "active" ] && { echo "STUDIO ACTIVE: not rendering"; exit 3; }
# a new project: no tour, no render results (the prepared scene, the material classes and the AI images stay)
rm -rf $P/tour $P/look/auto; mkdir -p $P/tour $P/look/auto; cp /tmp/mc.json $P/look/auto/materials-classes.json
if [ "$LABEL" = old ]; then SWITCH="ROOMIA_QUICK_PANOS=1 ROOMIA_LOOK_STREAM=0 ROOMIA_COMPOSITOR_GPU=0 ROOMIA_TRANSFER_FULLRES=1 ROOMIA_DUP_DISTANCE=0"; else SWITCH="ROOMIA_X=1"; fi
( env $SWITCH setsid nohup docs/speed-bench/start_server.sh > $OUT/server.log 2>&1 < /dev/null & )
for i in $(seq 1 30); do curl -s -m 2 http://127.0.0.1:3011/api/desktop/health >/dev/null && break; sleep 2; done; sleep 12
( while true; do echo "$(date +%s),$(nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader,nounits | tr -d ' '),$(free -m | awk 'NR==2{print $3}')"; sleep 5; done > $OUT/sampler.csv ) &
SAMPLER=$!
date +%s > $OUT/start.epoch
python3 docs/speed-bench/e2e.py confirm > $OUT/e2e.log 2>&1
date +%s > $OUT/end.epoch
kill $SAMPLER 2>/dev/null
PID=$(ss -ltnp 2>/dev/null | grep ":3011 " | grep -o "pid=[0-9]*" | head -1 | cut -d= -f2); [ -n "$PID" ] && kill $PID
cp -a $P/look/auto/state.json $OUT/state.json 2>/dev/null
ls -l --time-style=+%s $P/look/auto/t*-lin.npy $P/look/auto/stream/*.jpg $P/look/sunburst/pano-*-sunburst-2560.jpg $P/tour/pano-*.jpg 2>/dev/null | awk '{print $6, $7}' | sed "s#$P/##" > $OUT/file-times.txt
cp $P/tour/propose-log.txt $OUT/ 2>/dev/null; cp $P/tour/build-log.txt $OUT/ 2>/dev/null; cp $P/tour/tour.json $OUT/tour.json 2>/dev/null
echo "FULL_$LABEL DONE"
