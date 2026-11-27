#!/usr/bin/env python3
"""compare_images.py <reference dir or file pattern> <test ...> : mean abs diff and 99.9th percentile (0-255) between two images,
and, when both are .npy (linear EXR dumps), the same on the linear values scaled to display.
usage: compare_images.py a.jpg b.jpg [more pairs: a2 b2 ...]
"""
import sys
import numpy as np
from PIL import Image

def load(p):
    if p.endswith(".npy"):
        x = np.load(p).astype(np.float32)[..., :3]
        x = np.clip(x, 0, 1)
        return (np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055) * 255).astype(np.float32)
    return np.asarray(Image.open(p).convert("RGB"), np.float32)

args = sys.argv[1:]
for a, b in zip(args[0::2], args[1::2]):
    A, B = load(a), load(b)
    if A.shape != B.shape:
        print("%s vs %s: shapes differ %s %s" % (a.split("/")[-1], b.split("/")[-1], A.shape, B.shape)); continue
    d = np.abs(A - B)
    print("%-26s vs %-26s mean %.3f  p99 %.2f  p99.9 %.2f  max %.0f  (share >2/255: %.3f%%)" % (a.split("/")[-1], b.split("/")[-1], d.mean(), np.percentile(d, 99), np.percentile(d, 99.9), d.max(), 100 * (d > 2).mean()))
