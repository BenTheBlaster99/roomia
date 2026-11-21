#!/usr/bin/env python3
"""
Step 2 (21 Nov): the picture of views that are rendered but not yet exposed as a group, so the AI image and the light transfer can
start while the GPU renders the next views.

python look_stream_view.py <autoDir> <recipe.json> <names a,b,c> <median> <lift> <look> <width>

- runs look_finalize_panos.py with an unlimited range (99 stops): each view is exposed for itself, which is exactly what the group run
  does unless the view is more than RANGE (3) stops from the group's median;
- writes <autoDir>/stream/pano-<index>.jpg exactly as look_install_tour.py would install it (same resize, same JPEG settings), so a
  view the group run leaves unchanged has the very same bytes as the one installed in the tour (the caller checks that);
- prints "VIEW_READY <index>" per view.

The group run at the end of the render (look_pipeline.py finalize + install) is unchanged and rewrites everything it needs.
"""
import os
import subprocess
import sys

import cv2

auto, recipe, names, median, lift, look, width = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6], int(sys.argv[7])
here = os.path.dirname(os.path.abspath(__file__))
env = dict(os.environ, LIFT=lift, LOOK=look)
subprocess.run([sys.executable, os.path.join(here, "look_finalize_panos.py"), auto, recipe, names, median, "99.0"], env=env, check=True, stdout=subprocess.DEVNULL)
os.makedirs(os.path.join(auto, "stream"), exist_ok=True)
for name in names.split(","):
    index = name[1:]
    im = cv2.imread(os.path.join(auto, name + "-pano.png"))
    h, w = im.shape[:2]
    if w != width:
        im = cv2.resize(im, (width, width // 2), interpolation=cv2.INTER_AREA if w > width else cv2.INTER_LANCZOS4)
    dst = os.path.join(auto, "stream", "pano-%s.jpg" % index)
    cv2.imwrite(dst + ".tmp.jpg", im, [cv2.IMWRITE_JPEG_QUALITY, 92])
    os.replace(dst + ".tmp.jpg", dst)
    print("VIEW_READY", index, flush=True)
