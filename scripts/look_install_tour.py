"""
Puts recipe 360s into a scene's tour (8 Nov): tour/pano-<index>.jpg is what the 360 viewer shows when the AI 360 buttons are off.
The Cycles panorama it replaces is kept once as pano-<index>-cycles-old.jpg (never overwritten), so it can be put back.

python look_install_tour.py <tourDir> <width> <index>=<image> [<index>=<image> ...]
"""
import os, shutil, sys
import cv2

tour, width = sys.argv[1], int(sys.argv[2])
for pair in sys.argv[3:]:
    idx, src = pair.split("=", 1)
    dst = os.path.join(tour, "pano-%s.jpg" % idx)
    keep = os.path.join(tour, "pano-%s-cycles-old.jpg" % idx)
    if os.path.exists(dst) and not os.path.exists(keep):
        shutil.copy2(dst, keep)
    im = cv2.imread(src)
    h, w = im.shape[:2]
    if w != width:
        im = cv2.resize(im, (width, width // 2), interpolation=cv2.INTER_AREA if w > width else cv2.INTER_LANCZOS4)
    cv2.imwrite(dst, im, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print("INSTALLED", idx, src, "->", dst, im.shape[1], "x", im.shape[0])
