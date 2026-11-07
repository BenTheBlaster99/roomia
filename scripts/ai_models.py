"""
Local image model for the walk's refinement (8 Nov): SDXL + depth ControlNet + IP-Adapter, half precision, in
/media/jackhammer/DATA/Linux-Work/roomia-splat/hf (HF_HOME). Free, runs on the RTX 3060, nothing leaves the PC.

python ai_models.py     downloads what is missing (~11 GB, once)
"""
import os
os.environ.setdefault("HF_HOME", "/media/jackhammer/DATA/Linux-Work/roomia-splat/hf")
from huggingface_hub import snapshot_download

jobs = [
    ("stabilityai/stable-diffusion-xl-base-1.0", ["model_index.json", "scheduler/*", "tokenizer/*", "tokenizer_2/*",
        "text_encoder/config.json", "text_encoder/model.fp16.safetensors", "text_encoder_2/config.json", "text_encoder_2/model.fp16.safetensors",
        "unet/config.json", "unet/diffusion_pytorch_model.fp16.safetensors", "vae/config.json"]),
    ("madebyollin/sdxl-vae-fp16-fix", ["config.json", "diffusion_pytorch_model.safetensors"]),
    ("diffusers/controlnet-depth-sdxl-1.0", ["config.json", "diffusion_pytorch_model.fp16.safetensors"]),
    ("h94/IP-Adapter", ["sdxl_models/ip-adapter_sdxl_vit-h.safetensors", "models/image_encoder/*"]),
]
for repo, patterns in jobs:
    p = snapshot_download(repo, allow_patterns=patterns)
    print("MODEL", repo, p, flush=True)
print("MODELS_OK", flush=True)
