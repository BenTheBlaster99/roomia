#!/usr/bin/env python3
"""
Pilot-session tracker: writes one timestamped line per thing that happens, to .pilot-logs/.

  python3 scripts/pilot-tracker.py [tunnel-log-file] [hours]

Tracks: tunnel traffic and errors, uploads (piece by piece), scene status changes, every photo
render (from each scene's runs.jsonl) and saved photo files, the Studio service log, and the PC's
GPU / memory / disk. Lines starting with "EVENT" are the ones worth reading first.
"""
import glob
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCENES = os.path.join(ROOT, ".scenes")
LOGDIR = os.path.join(ROOT, ".pilot-logs")
os.makedirs(LOGDIR, exist_ok=True)
DAY = datetime.now().strftime("%Y-%m-%d")
OUT = os.path.join(LOGDIR, f"pilot-{DAY}.log")
JOURNAL = os.path.join(LOGDIR, f"studio-journal-{DAY}.log")
lock = threading.Lock()


def log(msg, event=False):
    line = f"{datetime.now().strftime('%H:%M:%S')} {'EVENT ' if event else ''}{msg}"
    with lock, open(OUT, "a") as f:
        f.write(line + "\n")


def find_tunnel_log():
    for path in sorted(glob.glob("/tmp/tmp.*"), key=os.path.getmtime, reverse=True)[:8]:
        try:
            if "trycloudflare" in open(path, errors="ignore").read(4000):
                return path
        except OSError:
            pass
    return None


def metrics():
    try:
        text = urllib.request.urlopen("http://127.0.0.1:20241/metrics", timeout=3).read().decode()
    except Exception:
        return None
    out = {}
    for key in ("total_requests", "request_errors", "concurrent_requests_per_tunnel"):
        m = re.search(rf"^cloudflared_tunnel_{key} (\S+)", text, re.M)
        out[key] = int(float(m.group(1))) if m else 0
    return out


def sh(cmd):
    try:
        return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=8).stdout.strip()
    except Exception:
        return ""


def follow_journal():
    proc = subprocess.Popen(
        ["journalctl", "--user", "-u", "roomia-studio", "-f", "-o", "cat", "--no-pager", "-n", "0"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
    )
    with open(JOURNAL, "a") as f:
        for line in proc.stdout:
            stamp = datetime.now().strftime("%H:%M:%S")
            f.write(f"{stamp} {line}")
            f.flush()
            if re.search(r"error|failed|exception|ENOENT|ERR_", line, re.I) and "deprecated" not in line:
                log(f"STUDIO LOG: {line.strip()[:220]}", event=True)


def follow_tunnel(path):
    proc = subprocess.Popen(["tail", "-n0", "-F", path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    for line in proc.stdout:
        if re.search(r" (ERR|WRN) |Registered tunnel|Retrying|Unable to reach", line):
            noisy = "context canceled" in line or "canceled by remote" in line
            log(f"TUNNEL: {line.strip()[:230]}", event=not noisy)


def scene_state(path):
    state = {}
    try:
        meta = json.load(open(os.path.join(path, "meta.json")))
    except Exception:
        return None
    state["status"] = meta.get("status")
    state["file"] = meta.get("fileName")
    state["error"] = (meta.get("error") or "")[:160]
    try:
        up = json.load(open(os.path.join(path, "upload.json")))
        state["pieces"] = f"{len(up['received'])}/{up['total']}"
        state["size_mb"] = round(up["size"] / 1048576)
    except Exception:
        state["pieces"] = None
    if meta.get("report"):
        r = meta["report"]
        state["prepared"] = f"{round(r['inBytes']/1048576)}MB/{r['trianglesIn']//1000}k tris -> {round(r['outBytes']/1048576,1)}MB/{r['trianglesOut']//1000}k tris in {round(r['totalSeconds'])}s"
    return state


def main():
    hours = float(sys.argv[2]) if len(sys.argv) > 2 else 5
    tunnel_log = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] != "-" else find_tunnel_log()
    log(f"=== tracker started (tunnel log: {tunnel_log}, for {hours} h) ===")
    threading.Thread(target=follow_journal, daemon=True).start()
    if tunnel_log:
        threading.Thread(target=follow_tunnel, args=(tunnel_log,), daemon=True).start()

    scenes, runs_seen, photos_seen = {}, {}, set()
    for d in glob.glob(os.path.join(SCENES, "*")):
        scenes[os.path.basename(d)] = scene_state(d)
        rf = os.path.join(d, "runs.jsonl")
        runs_seen[d] = sum(1 for _ in open(rf)) if os.path.exists(rf) else 0
        photos_seen.update(glob.glob(os.path.join(d, "photos", "*.jpg")))
    last_m, last_beat, last_active, service_up, tunnel_up = metrics(), 0, time.time(), True, True
    end = time.time() + hours * 3600

    while time.time() < end:
        # tunnel traffic
        m = metrics()
        if m and last_m:
            if m["total_requests"] > last_m["total_requests"]:
                idle = time.time() - last_active
                gained = m["total_requests"] - last_m["total_requests"]
                log(f"traffic: +{gained} requests (total {m['total_requests']}, errors {m['request_errors']}, open {m['concurrent_requests_per_tunnel']})",
                    event=idle > 120)
                last_active = time.time()
            if m["request_errors"] > last_m["request_errors"]:
                log(f"tunnel request errors: {last_m['request_errors']} -> {m['request_errors']}", event=True)
        if (m is None) != (not tunnel_up):
            tunnel_up = m is not None
            log("tunnel metrics " + ("back" if tunnel_up else "UNREACHABLE (tunnel down?)"), event=True)
        last_m = m or last_m

        # service
        up = sh("systemctl --user is-active roomia-studio") == "active"
        if up != service_up:
            service_up = up
            log("Studio service " + ("active again" if up else "NOT ACTIVE"), event=True)

        # scenes: new, changed, upload progress
        for d in glob.glob(os.path.join(SCENES, "*")):
            sid = os.path.basename(d)
            st = scene_state(d)
            if st is None:
                continue
            old = scenes.get(sid)
            if old is None:
                log(f"NEW SCENE {sid}: {st['file']} ({st.get('size_mb', '?')} MB, status {st['status']})", event=True)
            elif st != old:
                if st["status"] != old["status"]:
                    extra = st.get("prepared") or st["error"] or ""
                    log(f"scene {sid} ({st['file']}): {old['status']} -> {st['status']} {extra}", event=True)
                elif st.get("pieces") != old.get("pieces"):
                    done, total = (st["pieces"] or "0/0").split("/")
                    if int(done) % 5 == 0 or done == total:
                        log(f"upload {sid}: {st['pieces']} pieces ({st.get('size_mb', '?')} MB file)")
            scenes[sid] = st
            rf = os.path.join(d, "runs.jsonl")
            n = sum(1 for _ in open(rf)) if os.path.exists(rf) else 0
            if n > runs_seen.get(d, 0):
                for line in list(open(rf))[runs_seen.get(d, 0):]:
                    r = json.loads(line)
                    if r.get("ok"):
                        log(f"RENDER OK {sid}: {r['view']} / {r['time']} / sun {'on' if r['sun'] else 'off'}: capture {r.get('captureSeconds')}s + photo {r.get('photoSeconds')}s = {r['totalSeconds']}s ({r.get('quality')} {r.get('size')})", event=True)
                    else:
                        log(f"RENDER FAILED {sid}: {r['view']} / {r['time']}: {r.get('error')} (after {r.get('totalSeconds')}s)", event=True)
                runs_seen[d] = n
            for p in glob.glob(os.path.join(d, "photos", "*.jpg")):
                if p not in photos_seen:
                    photos_seen.add(p)
                    log(f"photo saved: {os.path.relpath(p, ROOT)} ({round(os.path.getsize(p)/1048576, 1)} MB)", event=True)

        # system
        if time.time() - last_beat >= 30:
            gpu = sh("nvidia-smi --query-gpu=utilization.gpu,memory.used,temperature.gpu --format=csv,noheader,nounits").split(",")
            mem = sh("free -m | awk 'NR==2{print $7}'")
            disk = sh("df -BG / | awk 'NR==2{print $4}'")
            data = sh("df -BG /media/jackhammer/DATA | awk 'NR==2{print $4}'")
            load = sh("cut -d' ' -f1 /proc/loadavg")
            warn = ""
            if mem.isdigit() and int(mem) < 1500:
                warn = " LOW MEMORY"
            log(f"system: GPU {gpu[0].strip() if gpu else '?'}% {gpu[1].strip() if len(gpu) > 1 else '?'}MiB {gpu[2].strip() if len(gpu) > 2 else '?'}C | free RAM {mem} MB | load {load} | disk free / {disk}, DATA {data}{warn}", event=bool(warn))
            last_beat = time.time()
        time.sleep(3)
    log("=== tracker finished ===")


if __name__ == "__main__":
    main()
