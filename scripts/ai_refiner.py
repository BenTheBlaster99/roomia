"""
The local refiner (8 Nov): SDXL img2img held to the real geometry by a depth ControlNet and to the approved AI photo's
look by an IP-Adapter, on the RTX 3060. Shared by ai_refine_pilot.py and ai_gain_panos.py.

Memory: the prompt and the reference photo are encoded once, the text and image encoders released, and the rest sits on
the card (the offloaded setup held ~10 GB in RAM and crashed the desktop, 8 Nov). ~5 s a 768 px frame.
"""
import math, os
os.environ.setdefault("HF_HOME", "/media/jackhammer/DATA/Linux-Work/roomia-splat/hf")
import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

PROMPT = "photorealistic architectural interior photograph, warm golden hour light, natural materials, rich fine textures, fabric weave, marble veining, wood grain, plaster, sharp focus, high detail"
NEGATIVE = "blurry, smooth plastic, painting, cartoon, distorted, warped, extra objects, text, watermark, lowres"


def look_bl(yaw, pitch):
    """camera-to-world rotation in Blender's frame, columns right, up, back (the capture's c2w)"""
    f = np.array([math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch)])
    r = np.cross(f, [0, 0, 1.0]); r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return np.stack([r, u, -f], 1)


def cut(pano, depth, R, size, fov):
    """a pinhole view (colour, planar depth) of an equirect, in the capture's projection"""
    H, W = pano.shape[:2]
    fl = size / 2 / math.tan(math.radians(fov) / 2)
    a = (np.arange(size) + 0.5 - size / 2) / fl
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
    s = F.grid_sample(t, torch.from_numpy(grid).float()[None], mode="bilinear", padding_mode="border", align_corners=False)[0].permute(1, 2, 0).numpy()
    return s[..., :3], s[..., 3] / np.linalg.norm(loc, axis=-1)


def depth_image(z):
    """near = bright, from inverse depth (what the depth control expects)"""
    inv = 1.0 / np.clip(z, 0.2, 60.0)
    lo, hi = np.percentile(inv, 1), np.percentile(inv, 99)
    d = np.clip((inv - lo) / max(hi - lo, 1e-6), 0, 1)
    return Image.fromarray((np.stack([d] * 3, -1) * 255).astype(np.uint8))


def equirect_dirs(W, H):
    """Blender-frame direction of every equirect pixel (the inverse of cut's mapping)"""
    col = (np.arange(W) + 0.5) / W
    row = (np.arange(H) + 0.5) / H
    az = math.pi - col * 2 * math.pi
    lat = math.pi / 2 - row * math.pi
    az, lat = np.meshgrid(az, lat)
    return np.stack([np.cos(lat) * np.cos(az), np.cos(lat) * np.sin(az), np.sin(lat)], -1)


class Refiner:
    def __init__(self, ref_path=None, prompt=PROMPT, negative=NEGATIVE, ip_scale=0.4, log=print):
        from diffusers import AutoencoderKL, ControlNetModel, StableDiffusionXLControlNetImg2ImgPipeline, UniPCMultistepScheduler
        vae = AutoencoderKL.from_pretrained("madebyollin/sdxl-vae-fp16-fix", torch_dtype=torch.float16)
        cn = ControlNetModel.from_pretrained("diffusers/controlnet-depth-sdxl-1.0", torch_dtype=torch.float16, variant="fp16", use_safetensors=True)
        pipe = StableDiffusionXLControlNetImg2ImgPipeline.from_pretrained("stabilityai/stable-diffusion-xl-base-1.0", controlnet=cn, vae=vae, torch_dtype=torch.float16, variant="fp16", use_safetensors=True)
        pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)
        ref = None
        if ref_path:
            pipe.load_ip_adapter("h94/IP-Adapter", subfolder="sdxl_models", weight_name="ip-adapter_sdxl_vit-h.safetensors", image_encoder_folder="models/image_encoder")
            pipe.set_ip_adapter_scale(ip_scale)
            ref = Image.open(ref_path).convert("RGB")
        encs = [pipe.text_encoder, pipe.text_encoder_2] + ([pipe.image_encoder] if ref is not None else [])
        for m in encs:
            m.to("cuda")
        with torch.no_grad():
            pe, npe, ppe, nppe = pipe.encode_prompt(prompt, None, "cuda", 1, True, negative_prompt=negative)
            self.emb = dict(prompt_embeds=pe, negative_prompt_embeds=npe, pooled_prompt_embeds=ppe, negative_pooled_prompt_embeds=nppe)
            if ref is not None:
                self.emb["ip_adapter_image_embeds"] = pipe.prepare_ip_adapter_image_embeds(ref, None, "cuda", 1, True)
        pipe.register_modules(text_encoder=None, text_encoder_2=None, **({"image_encoder": None} if ref is not None else {}))
        import gc
        del encs
        gc.collect()
        torch.cuda.empty_cache()
        pipe.unet.to("cuda"); pipe.controlnet.to("cuda"); pipe.vae.to("cuda")
        pipe.vae.enable_tiling()
        self.pipe = pipe

    def __call__(self, image, depth, strength=0.3, control=0.9, steps=26, guidance=5.5, seed=7):
        gen = torch.Generator("cpu").manual_seed(seed)
        return self.pipe(image=image, control_image=depth, strength=strength, controlnet_conditioning_scale=control,
                         num_inference_steps=steps, guidance_scale=guidance, generator=gen, **self.emb).images[0]
