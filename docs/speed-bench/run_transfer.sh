#!/bin/bash
# usage: run_transfer.sh <label> <views a,b,c> [extra env as VAR=1 ...]
# Runs ONLY the light transfer (scripts/pano_look_transfer.py) on the inputs the baseline run left in the speed-test copy, one view at
# a time, timing each, and compares with the baseline's finished pictures (same inputs: any difference comes from the code).
set -u
WT=/media/jackhammer/DATA/Linux-Work/Projects/roomia-speed
P=/media/jackhammer/DATA/Linux-Work/roomia-speed-test/projects/BlocBF5Speed000000001
RES=/media/jackhammer/DATA/Linux-Work/roomia-speed-test/results
LABEL=$1; VIEWS=$2; shift 2
OUT=$RES/$LABEL; mkdir -p $OUT
cd $WT
for k in ${VIEWS//,/ }; do
  t0=$(date +%s.%N)
  env -u PYTHONPATH "$@" /usr/bin/time -f "rss_kb=%M" /home/jackhammer/roomia-ai-venv/bin/python scripts/pano_look_transfer.py \
    $P/tour/pano-$k-before-sunburst.jpg $P/look/sunburst/pano-$k-sunburst-2560-seam.jpg $OUT/x-$k.jpg \
    --gain-min 0.75 --gain-max 1.6 --radius 96 --blender-linear $P/look/auto/t$k-lin.npy > $OUT/log-$k.txt 2>&1
  t1=$(date +%s.%N)
  echo "view $k: $(python3 -c "print('%.1f s' % ($t1-$t0))")  $(grep -o 'rss_kb=[0-9]*' $OUT/log-$k.txt)"
done
/home/jackhammer/roomia-ai-venv/bin/python docs/speed-bench/compare_images.py $(for k in ${VIEWS//,/ }; do echo $RES/baseline/final-$k.jpg $OUT/x-$k.jpg; done)
