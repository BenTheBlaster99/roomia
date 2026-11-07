"""
Pilot (8 Nov): can a free local model refine the walk's own frames with consistent textures?

Cuts pinhole views out of the capture's panoramas (the same views the trainer sees), shows them as the walk would (the
look's exposure and grade), refines each with SDXL (img2img, low strength) held to the real geometry by the depth
channel (ControlNet) and to the approved AI photo's look (IP-Adapter), then writes input | refined pairs. The test of
continuity: the same wall or chair seen from neighbouring spots must come out the same.

python ai_refine_pilot.py <capture dir> <out dir> '<json: {pick: [[pano index, yaw deg, pitch deg], ...], ref, strength, ...}>'
"""
import json, math, os, sys, time
os.environ.setdefault("HF_HOME", "/media/jackhammer/DATA/Linux-Work/roomia-splat/hf")
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from look_grade import grade  # the walk's display pipeline

cap, out = sys.argv[1], sys.argv[2]
opt = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
os.makedirs(out, exist_ok=True)
SIZE = int(opt.get("size", 1024))
FOV = float(opt.get("fov", 90.0))
meta = json.load(open(os.path.join(cap, "panos.json")))
GRADE = opt.get("grade", {})
EXPO = float(opt.get("exposure", 1.0))
dev = "cuda"


def look_bl(yaw, pitch):
    f = np.array([math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch)])
    r = np.cross(f, [0, 0, 1.0]); r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return np.stack([r, u, -f], 1)


def cut(pano, depth, R):
    """pinhole view of an equirect (rows top = up) in the capture's projection"""
    H, W = pano.shape[:2]
    fl = SIZE / 2 / math.tan(math.radians(FOV) / 2)
    a = (np.arange(SIZE) + 0.5 - SIZE / 2) / fl
    gy, gx = np.meshgrid(-a, a, indexing="ij")
    loc = np.stack([gx, gy, -np.ones_like(gx)], -1)
    d = loc @ R.T
    d /= np.linalg.norm(d, axis=-1, keepdims=True)
    az = np.arctan2(d[..., 1], d[..., 0])
    lat = np.arcsin(np.clip(d[..., 2], -1, 1))
    col = np.mod(math.pi - az, 2 * math.pi) / (2 * math.pi) * W - 0.5
    row = (math.pi / 2 - lat) / math.pi * H - 0.5
    t = torch.from_numpy(np.concatenate([pano, depth[..., None]], -1)).permute(2, 0, 1)[None].float()
    t = torch.cat([t[..., -1:], t, t[..., :1]], -1)  # one column of wrap each side
    grid = np.stack([(col + 1 + 0.5) / (W + 2) * 2 - 1, (row + 0.5) / H * 2 - 1], -1)
    grid = torch.from_numpy(grid).float()[None]
    s = F.grid_sample(t, grid, mode="bilinear", padding_mode="border", align_corners=False)[0].permute(1, 2, 0).numpy()
    ray = s[..., 3] / np.linalg.norm(loc, axis=-1)  # planar depth
    return s[..., :3], ray


def depth_image(z):
    # near = bright, from inverse depth, the model's depth control expects this
    inv = 1.0 / np.clip(z, 0.2, 60.0)
    lo, hi = np.percentile(inv, 1), np.percentile(inv, 99)
    d = np.clip((inv - lo) / max(hi - lo, 1e-6), 0, 1)
    return Image.fromarray((np.stack([d] * 3, -1) * 255).astype(np.uint8))


views = []
for pi_, yaw, pitch in opt["pick"]:
    p = meta["panos"][int(pi_)]
    z = np.load(os.path.join(cap, p["file"]))
    pano = z["rgb"].astype(np.float32)
    dep = np.minimum(z["depth"].astype(np.float32), 100.0)
    lin, zz = cut(pano, dep, look_bl(math.radians(yaw), math.radians(pitch)))
    shown = grade(lin * EXPO, GRADE)
    views.append({"pano": int(pi_), "yaw": yaw, "pitch": pitch, "eye": p["eye"], "img": Image.fromarray((shown * 255 + 0.5).astype(np.uint8)), "depth": depth_image(zz)})
print("PILOT cut %d views" % len(views), flush=True)

from diffusers import AutoencoderKL, ControlNetModel, StableDiffusionXLControlNetImg2ImgPipeline, UniPCMultistepScheduler
t0 = time.time()
vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=torch.float16)
cn = ControlNetModel.from_pretrained("diffusers/controlnet-depth-sdxl-1.0", torch_dtype=torch.float16, variant="fp16", use_safetensors=True)
pipe = StableDiffusionXLControlNetImg2ImgPipeline.from_pretrained("stabilityai/stable-diffusion-xl-base-1.0", controlnet=cn, vae=vae, torch_dtype=torch.float16, variant="fp16", use_safetensors=True)
pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)
ref = None
if opt.get("ref"):
    pipe.load_ip_adapter("h94/IP-Adapter", subfolder="sdxl_models", weight_name="ip-adapter_sdxl_vit-h.safetensors", image_encoder_folder="models/image_encoder")
    pipe.set_ip_adapter_scale(float(opt.get("ipScale", 0.5)))
    ref = Image.open(opt["ref"]).convert("RGB")
prompt = opt.get("prompt", "photorealistic architectural interior photograph, warm golden hour light, natural materials, rich fine textures, fabric weave, marble veining, wood grain, plaster, sharp focus, high detail")
neg = opt.get("negative", "blurry, smooth plastic, painting, cartoon, distorted, warped, extra objects, text, watermark, lowres")
EMB = {}
if opt.get("gpuResident", True):
    # the text encoders and the style photo's encoder are needed once (the prompt and the reference do not change):
    # encode, release them, and keep only what runs at every frame on the card (12 GB; SDXL + control + adapter all
    # at once ran it out of memory, and the offloaded setup held ~10 GB in RAM and crashed the desktop, 8 Nov)
    for m_ in (pipe.text_encoder, pipe.text_encoder_2) + ((pipe.image_encoder,) if ref is not None else ()):
        m_.to("cuda")
    with torch.no_grad():
        pe, npe, ppe, nppe = pipe.encode_prompt(prompt, None, "cuda", 1, True, negative_prompt=neg)
        EMB = dict(prompt_embeds=pe, negative_prompt_embeds=npe, pooled_prompt_embeds=ppe, negative_pooled_prompt_embeds=nppe)
        if ref is not None:
            EMB["ip_adapter_image_embeds"] = pipe.prepare_ip_adapter_image_embeds(ref, None, "cuda", 1, True)
    pipe.register_modules(text_encoder=None, text_encoder_2=None, **({"image_encoder": None} if ref is not None else {}))
    import gc
    gc.collect()
    torch.cuda.empty_cache()
    pipe.unet.to("cuda")
    pipe.controlnet.to("cuda")
    pipe.vae.to("cuda")
    pipe.vae.enable_tiling()
else:
    pipe.enable_model_cpu_offload()
print("PILOT model ready %.0fs" % (time.time() - t0), flush=True)

results = []
for k, v in enumerate(views):
    t1 = time.time()
    gen = torch.Generator("cpu").manual_seed(int(opt.get("seed", 7)))
    kw = dict(EMB) if EMB else ({"ip_adapter_image": ref} if ref is not None else {})
    if not EMB:
        kw.update(prompt=prompt, negative_prompt=neg)
    img = pipe(image=v["img"], control_image=v["depth"], strength=float(opt.get("strength", 0.4)),
               controlnet_conditioning_scale=float(opt.get("controlScale", 0.7)), num_inference_steps=int(opt.get("steps", 28)),
               guidance_scale=float(opt.get("guidance", 5.5)), generator=gen, **kw).images[0]
    name = "v%02d-p%d-y%d" % (k, v["pano"], v["yaw"])
    v["img"].save(os.path.join(out, name + "-in.jpg"), quality=92)
    v["depth"].save(os.path.join(out, name + "-depth.png"))
    img.save(os.path.join(out, name + "-ai.jpg"), quality=92)
    pair = Image.new("RGB", (SIZE * 2, SIZE))
    pair.paste(v["img"], (0, 0)); pair.paste(img, (SIZE, 0))
    pair.resize((SIZE, SIZE // 2)).save(os.path.join(out, name + "-pair.jpg"), quality=90)
    results.append({"name": name, "pano": v["pano"], "yaw": v["yaw"], "pitch": v["pitch"], "seconds": round(time.time() - t1, 1)})
    print("PILOT %s %.1fs" % (name, time.time() - t1), flush=True)
json.dump({"options": opt, "views": results}, open(os.path.join(out, "pilot.json"), "w"), indent=1)
print("PILOT_OK", flush=True)
