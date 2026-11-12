scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.resolution_percentage = 100
scene.render.fps = FPS
# (recipe mode) linear EXR out of the compositor; each frame is graded with the 360's own function and saved as the PNG the film reads
scene.render.image_settings.file_format = "OPEN_EXR"
scene.render.image_settings.color_depth = "16"
scene.render.image_settings.exr_codec = "ZIP"
raw_dir = spec.get("rawDir") or os.path.join(out_dir, "raw")
os.makedirs(raw_dir, exist_ok=True)
scene.render.filepath = os.path.join(raw_dir, "r-")
scene.frame_start, scene.frame_end = 1, len(shots) * SHOT
# resume (a render stopped by the memory guard or a crash): continue after the last finished frame (the last file may be cut short: redone)
if spec.get("resume"):
    have = 0
    while os.path.exists(os.path.join(frames_dir, "f-%04d.png" % (have + 1))):
        have += 1
    if have:
        os.remove(os.path.join(frames_dir, "f-%04d.png" % have))
        have -= 1
    scene.frame_start = min(have + 1, scene.frame_end)
    print("VIDEO_INFO resuming at frame %d" % scene.frame_start, flush=True)
GR = dict(LOOK.get("grade") or R.get("grade", {}), exposure=float(spec.get("exposureEV", 0.0)))
WBG = np.array(spec.get("wb", [1.0, 1.0, 1.0]), np.float32)
LIFT = float(spec.get("lift", 0.04))
print("VIDEO_INFO grade exposure %.2f EV, white balance %s, lift %.2f" % (GR["exposure"], WBG.tolist(), LIFT), flush=True)

def read_exr(path):
    inp = oiio.ImageInput.open(path)
    sp = inp.spec()
    px = inp.read_image(0, 0, 0, sp.nchannels, "float").reshape(sp.height, sp.width, sp.nchannels)
    inp.close()
    names = list(sp.channelnames)
    idx = [names.index(c) for c in ("R", "G", "B")]
    return px[..., idx]

def write_png(path, img):
    o = oiio.ImageOutput.create(path)
    o.open(path, oiio.ImageSpec(img.shape[1], img.shape[0], 3, "uint8"))
    o.write_image((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8))
    o.close()

t_render = time.time()
t_prev = [time.time()]
PG = spec.get("pointGrades") or {}
def frame_written(sc, *args):
    t_a = time.time()
    p = sc.render.frame_path(frame=sc.frame_current)
    # the shot's own point: its exposure and white balance from the 360's finalize (a dark corridor is lifted, a bright room is not)
    pg = PG.get(str(shots[min((sc.frame_current - 1) // SHOT, len(shots) - 1)]["stop"]["index"]))
    gr_f = dict(GR, exposure=float(pg["ev"])) if pg else GR
    wb_f = np.array(pg["wb"], np.float32) if pg else WBG
    img = np.clip(grade(read_exr(p) * wb_f, gr_f), 0, 1)
    if LIFT:
        img = np.clip(img + LIFT * (1 - img) ** 3, 0, 1)
    write_png(os.path.join(frames_dir, "f-%04d.png" % sc.frame_current), img)
    os.remove(p)
    print("VIDEO_FRAME %d render %.1f grade %.1f" % (sc.frame_current, t_a - t_prev[0], time.time() - t_a), flush=True)
    t_prev[0] = time.time()
    print("VIDEO_STEP frame %d %.1f" % (sc.frame_current, time.time() - t_render), flush=True)
bpy.app.handlers.render_write.append(frame_written)
bpy.ops.render.render(animation=True)
bpy.app.handlers.render_write.remove(frame_written)
