#!/bin/bash
# The app's server as the desktop starts it (desktop/main.js serverEnv), on the speed-test copy, port 3011, its own database and logs.
# ROOMIA_FAKE_GATEWAY_DELAY: no AI call is ever made; the gateway is replaced by a wait of that many seconds (default 70).
WT=/media/jackhammer/DATA/Linux-Work/Projects/roomia-speed
BL=/media/jackhammer/DATA/Linux-Work/tools/blender-4.5.9-linux-x64
D=/media/jackhammer/DATA/Linux-Work/roomia-speed-test
mkdir -p $D/data $D/logs $D/tmp
cd $WT
exec env NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3011 HOSTNAME=127.0.0.1 ROOMIA_DESKTOP=1 SCENES_DIR=$D/projects SCENE_TTL_HOURS=0 \
  ROOMIA_DB_PATH=$D/data/roomia.db ROOMIA_TOUR_PREVIEW=1 ROOMIA_LOG_DIR=$D/logs TMPDIR=$D/tmp \
  ROOMIA_BLENDER=$BL/blender ROOMIA_PYTHON=$BL/4.5/python/bin/python3.11 ROOMIA_GPU_BACKEND=OPTIX ROOMIA_RENDER_PROFILE=balanced \
  ROOMIA_GPU_NAME="NVIDIA GeForce RTX 3060" ROOMIA_GPU_VRAM_MB=12288 ROOMIA_RAM_MB=15415 ROOMIA_APP_VERSION=0.5.3-speed \
  PYTHONPATH=$WT/desktop/pylib-linux ROOMIA_LOOK_MATERIALS_AI=0 ROOMIA_FAKE_GATEWAY_DELAY=${FAKE_DELAY:-70} \
  ROOMIA_DIST=.next-speed NODE_PATH=$WT/node_modules ROOMIA_SPARK_DIR=/home/jackhammer/roomia-mods/node_modules/@sparkjsdev/spark \
  /home/jackhammer/.nvm/versions/node/v24.18.0/bin/node node_modules/next/dist/bin/next start -p 3011
