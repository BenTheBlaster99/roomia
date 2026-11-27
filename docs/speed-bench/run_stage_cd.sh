#!/bin/bash
# usage: run_stage_cd.sh <label> <comma separated points> [--no-ai]
# Stage C (quality render) then stage D's cheap transfer (AI images already in look/sunburst: free) on the speed-test copy of the F5.
# Results land in $RESULTS/<label>/ : timings.txt, render.log, parsed.txt, t<N>-lin.npy, t<N>-pano.png, final-<N>.jpg
set -u
WT=/media/jackhammer/DATA/Linux-Work/Projects/roomia-speed
SCENES=/media/jackhammer/DATA/Linux-Work/roomia-speed-test/projects
ID=BlocBF5Speed000000001
RESULTS=${RESULTS:-/media/jackhammer/DATA/Linux-Work/roomia-speed-test/results}
LABEL=$1; PTS=$2
OUT=$RESULTS/$LABEL; mkdir -p $OUT
BL=/media/jackhammer/DATA/Linux-Work/tools/blender-4.5.9-linux-x64
if [ "$(systemctl --user is-active roomia-studio)" = "active" ]; then echo "STUDIO ACTIVE: the user is demoing, not rendering"; exit 3; fi
cd $WT
t0=$(date +%s.%N)
env SCENES_DIR=$SCENES ROOMIA_BLENDER=$BL/blender ROOMIA_GPU_VRAM_MB=12288 ROOMIA_GPU_BACKEND=OPTIX ROOMIA_RAM_MB=15415 ROOMIA_LOOK_MATERIALS_AI=0 \
  PYTHONPATH=$WT/desktop/pylib-linux $BL/4.5/python/bin/python3.11 scripts/look_pipeline.py render $ID --points $PTS > $OUT/pipeline.log 2>&1
rc=$?
t1=$(date +%s.%N)
cp $SCENES/$ID/look/auto/render.log $OUT/render.log 2>/dev/null
python3 docs/speed-bench/parse_render_log.py $OUT/render.log > $OUT/parsed.txt 2>&1
for p in ${PTS//,/ }; do cp $SCENES/$ID/look/auto/t$p-lin.npy $SCENES/$ID/look/auto/t$p-pano.png $OUT/ 2>/dev/null; done
t2=$t1
if [ "${3:-}" != "--no-ai" ]; then
  env -u PYTHONPATH /home/jackhammer/roomia-ai-venv/bin/python scripts/pano_ai_light.py --scene-dir $SCENES/$ID --views $PTS --auto auto --finish-only --transfer > $OUT/ai.log 2>&1
  t2=$(date +%s.%N)
  for p in ${PTS//,/ }; do cp $SCENES/$ID/tour/pano-$p.jpg $OUT/final-$p.jpg 2>/dev/null; done
fi
python3 - <<PY > $OUT/timings.txt
t0,t1,t2=$t0,$t1,$t2
print("label $LABEL points $PTS render_exit $rc")
print("stage C wall %.0f s | stage D transfer wall %.0f s | total %.0f s" % (t1-t0, t2-t1, t2-t0))
PY
cat $OUT/timings.txt
