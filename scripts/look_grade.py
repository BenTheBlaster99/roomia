"""
The look's display pipeline (7 Nov, Phase 1), shared by the Cycles reference and the walk: linear light -> exposure ->
white balance -> three.js AgX (the walk's own, splatLayer.ts AGX) -> contrast / saturation / split toning -> sRGB.
The grade is never baked into the light: the walk applies these same steps in its composite shader.
"""
import numpy as np

# GLSL mat3(a, b, c) takes columns; these are the walk's matrices written as rows (transposed)
SRGB_TO_2020 = np.array([[0.6274, 0.0691, 0.0164], [0.3293, 0.9195, 0.0880], [0.0433, 0.0113, 0.8956]], np.float32).T
R2020_TO_SRGB = np.array([[1.6605, -0.1246, -0.0182], [-0.5876, 1.1329, -0.1006], [-0.0728, -0.0083, 1.1187]], np.float32).T
INSET = np.array([[0.856627153315983, 0.137318972929847, 0.11189821299995], [0.0951212405381588, 0.761241990602591, 0.0767994186031903],
                  [0.0482516061458583, 0.101439036467562, 0.811302368396859]], np.float32).T
OUTSET = np.array([[1.1271005818144368, -0.1413297634984383, -0.14132976349843826], [-0.11060664309660323, 1.157823702216272, -0.11060664309660294],
                   [-0.016493938717834573, -0.016493938717834257, 1.2519364065950405]], np.float32).T
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def agx(c):
    c = c @ SRGB_TO_2020.T @ INSET.T
    c = np.clip((np.log2(np.maximum(c, 1e-10)) + 12.47393) / (4.026069 + 12.47393), 0, 1)
    x2 = c * c
    x4 = x2 * x2
    c = 15.5 * x4 * x2 - 40.14 * x4 * c + 31.96 * x4 - 6.868 * x2 * c + 0.4298 * x2 + 0.1191 * c - 0.00232
    c = c @ OUTSET.T
    c = np.power(np.maximum(c, 0), 2.2) @ R2020_TO_SRGB.T
    return np.clip(c, 0, 1)


def srgb(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0), 1 / 2.4) - 0.055)


def kelvin_rgb(k):
    """Approximate blackbody colour (linear, max 1) for a colour temperature in kelvin."""
    t = k / 100.0
    r = 255.0 if t <= 66 else 329.698727446 * (t - 60) ** -0.1332047592
    g = 99.4708025861 * np.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * (t - 60) ** -0.0755148492
    b = 255.0 if t >= 66 else (0.0 if t <= 19 else 138.5177312231 * np.log(t - 10) - 305.0447927307)
    s = np.clip(np.array([r, g, b]) / 255.0, 0, 1)
    lin = np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4)
    return lin / lin.max()


def grade(lin, g):
    """lin: H x W x 3 linear scene light. g: the recipe's grade. Returns display sRGB in 0..1."""
    c = lin * (2.0 ** float(g.get("exposure", 0.0)))
    wb = np.array(g.get("whiteBalance", [1, 1, 1]), np.float32)
    c = c * (wb / float(wb @ LUMA))
    c = agx(c)
    s = srgb(c)
    k = float(g.get("contrast", 1.0))
    if k != 1.0:
        p = float(g.get("pivot", 0.45))
        s = p + (s - p) * k
    sat = float(g.get("saturation", 1.0))
    if sat != 1.0:
        y = (s @ LUMA)[..., None]
        s = y + (s - y) * sat
    # split toning: a colour pushed into the shadows and another into the highlights (by luminance)
    if g.get("shadows") or g.get("highlights"):
        y = np.clip(s @ LUMA, 0, 1)[..., None]
        if g.get("shadows"):
            s = s + np.array(g["shadows"], np.float32) * (1 - y) ** 2
        if g.get("highlights"):
            s = s + np.array(g["highlights"], np.float32) * y ** 2
    return np.clip(s, 0, 1)
