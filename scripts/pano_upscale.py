"""
Sharpness back for an AI-finished 360 (12 Nov): the one-pass AI panorama (pano-sunburst.mts, 2560x1280) is soft once spread over the
whole sphere. Real-ESRGAN x4plus, run locally on the GPU (free), redraws crisp edges and texture at 4x; the result is brought to the
tour's size. The panorama wraps around: the left and right edges are padded with each other before the upscale, so the join stays clean.

python pano_upscale.py <in.jpg> <out.jpg> [--width 6144] [--mix 1.0] [--clarity 0.35] [--tile 512] [--model /home/jackhammer/roomia-models/RealESRGAN_x4plus.pth]
Runs with the AI python (torch + cv2): /home/jackhammer/roomia-ai-venv/bin/python
"""
import argparse, time
import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

ap = argparse.ArgumentParser()
ap.add_argument("inp")
ap.add_argument("out")
ap.add_argument("--width", type=int, default=6144)
ap.add_argument("--tile", type=int, default=512)
ap.add_argument("--pad", type=int, default=24)
ap.add_argument("--model", default="/home/jackhammer/roomia-models/RealESRGAN_x4plus.pth")
ap.add_argument("--mix", type=float, default=1.0, help="share of the upscaler's redrawn detail over a plain resize (1 = all of it)")
ap.add_argument("--clarity", type=float, default=0.0, help="local contrast on the lightness, 0..0.5 (12 Nov: 0.35 on Blender + AI light)")
args = ap.parse_args()


# ---- RRDBNet, the Real-ESRGAN x4plus generator (same layer names as the published weights)
class RDB(nn.Module):
    def __init__(self, nf=64, gc=32):
        super().__init__()
        self.conv1 = nn.Conv2d(nf, gc, 3, 1, 1)
        self.conv2 = nn.Conv2d(nf + gc, gc, 3, 1, 1)
        self.conv3 = nn.Conv2d(nf + 2 * gc, gc, 3, 1, 1)
        self.conv4 = nn.Conv2d(nf + 3 * gc, gc, 3, 1, 1)
        self.conv5 = nn.Conv2d(nf + 4 * gc, nf, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(0.2, inplace=True)

    def forward(self, x):
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
        return x5 * 0.2 + x


class RRDB(nn.Module):
    def __init__(self, nf=64, gc=32):
        super().__init__()
        self.rdb1, self.rdb2, self.rdb3 = RDB(nf, gc), RDB(nf, gc), RDB(nf, gc)

    def forward(self, x):
        return self.rdb3(self.rdb2(self.rdb1(x))) * 0.2 + x


class RRDBNet(nn.Module):
    def __init__(self, nb=23, nf=64, gc=32):
        super().__init__()
        self.conv_first = nn.Conv2d(3, nf, 3, 1, 1)
        self.body = nn.Sequential(*[RRDB(nf, gc) for _ in range(nb)])
        self.conv_body = nn.Conv2d(nf, nf, 3, 1, 1)
        self.conv_up1 = nn.Conv2d(nf, nf, 3, 1, 1)
        self.conv_up2 = nn.Conv2d(nf, nf, 3, 1, 1)
        self.conv_hr = nn.Conv2d(nf, nf, 3, 1, 1)
        self.conv_last = nn.Conv2d(nf, 3, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(0.2, inplace=True)

    def forward(self, x):
        feat = self.conv_first(x)
        feat = feat + self.conv_body(self.body(feat))
        feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode="nearest")))
        feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode="nearest")))
        return self.conv_last(self.lrelu(self.conv_hr(feat)))


t0 = time.time()
dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
net = RRDBNet()
sd = torch.load(args.model, map_location="cpu", weights_only=True)
net.load_state_dict(sd.get("params_ema", sd.get("params", sd)), strict=True)
net = net.eval().to(dev)
half = dev.type == "cuda"
if half:
    net = net.half()

img = cv2.imread(args.inp, cv2.IMREAD_COLOR)
H, W = img.shape[:2]
P = args.pad
# wrap left/right (the sphere's join), mirror top/bottom
wrapped = np.concatenate([img[:, -P:], img, img[:, :P]], axis=1)
wrapped = cv2.copyMakeBorder(wrapped, P, P, 0, 0, cv2.BORDER_REFLECT)
x = torch.from_numpy(cv2.cvtColor(wrapped, cv2.COLOR_BGR2RGB)).permute(2, 0, 1).float().div(255).unsqueeze(0)
_, _, h, w = x.shape
out = torch.zeros((1, 3, h * 4, w * 4))
T, O = args.tile, 16
with torch.inference_mode():
    for y0 in range(0, h, T):
        for x0 in range(0, w, T):
            ya, yb = max(0, y0 - O), min(h, y0 + T + O)
            xa, xb = max(0, x0 - O), min(w, x0 + T + O)
            tile = x[:, :, ya:yb, xa:xb].to(dev)
            tile = tile.half() if half else tile
            r = net(tile).float().clamp(0, 1).cpu()
            oy, ox = (y0 - ya) * 4, (x0 - xa) * 4
            th, tw = (min(h, y0 + T) - y0) * 4, (min(w, x0 + T) - x0) * 4
            out[:, :, y0 * 4:y0 * 4 + th, x0 * 4:x0 * 4 + tw] = r[:, :, oy:oy + th, ox:ox + tw]
big = (out[0].permute(1, 2, 0).numpy() * 255 + 0.5).astype(np.uint8)
big = cv2.cvtColor(big, cv2.COLOR_RGB2BGR)[P * 4:P * 4 + H * 4, P * 4:P * 4 + W * 4]
res = cv2.resize(big, (args.width, args.width // 2), interpolation=cv2.INTER_AREA)
if args.mix < 1.0 or args.clarity > 0:
    lo = cv2.resize(img, (args.width, args.width // 2), interpolation=cv2.INTER_LANCZOS4).astype(np.float32) / 255
    x = lo + args.mix * (res.astype(np.float32) / 255 - lo)
    if args.clarity > 0:
        lab = cv2.cvtColor(np.clip(x, 0, 1), cv2.COLOR_BGR2LAB)
        L = lab[..., 0]
        lab[..., 0] = np.clip(L + args.clarity * (L - cv2.GaussianBlur(L, (0, 0), 18)), 0, 100)
        x = cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)
    res = (np.clip(x, 0, 1) * 255 + 0.5).astype(np.uint8)
cv2.imwrite(args.out, res, [cv2.IMWRITE_JPEG_QUALITY, 93])
print("UPSCALE %dx%d -> %dx%d in %.1f s on %s" % (W, H, res.shape[1], res.shape[0], time.time() - t0, dev.type))
