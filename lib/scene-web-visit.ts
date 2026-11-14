import type { TourView } from './scene-tour'

/**
 * The visit for a website (15 Nov, the user: a client wants our 360° inside his own site). One page, index.html, beside the
 * 360° images in the export's 360 folder: no library, no server of ours, works for years. The client's web developer copies the
 * folder and adds one <iframe>. Opened from the disk (a double-click) Chrome refuses images from files to WebGL, so each 360° is
 * also in visite-data/NN.js as a data URL, used only then.
 */

export const WEB_VISIT_README = `Visite 360° Roomia

Ouvrir la visite : double-cliquez sur index.html.

Mettre la visite sur un site internet :
1. Copiez tout ce dossier « 360 » sur le serveur du site, par exemple dans /visite-360/
2. Dans la page où la visite doit apparaître, ajoutez :

   <iframe src="/visite-360/index.html" width="100%" height="600" style="border:0" allowfullscreen></iframe>

Les images .jpg de ce dossier sont des panoramas 360° standards (équirectangulaires) : Facebook, Google et les
visionneuses 360° les reconnaissent aussi seules.
`

/** One 360° as a script that hands its picture to the page as a data URL (the double-click case). */
export function panoDataScript(key: string, jpg: Buffer) {
  return `window.ROOMIA_PANO=window.ROOMIA_PANO||{};window.ROOMIA_PANO[${JSON.stringify(key)}]="data:image/jpeg;base64,${jpg.toString('base64')}";\n`
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export function webVisitHtml(title: string, views: TourView[], panoNames: Map<number, string>) {
  const points = views
    .filter(v => panoNames.has(v.index))
    .map(v => ({
      i: v.index,
      n: v.name,
      f: panoNames.get(v.index)!,
      k: panoNames.get(v.index)!.slice(0, 2),
      p: v.position,
      t: v.target,
      l: v.links,
      y: v.startYaw ?? (v.noPhoto && !v.auto ? Math.PI : 0),
    }))
  const data = JSON.stringify({ title, points }).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,">
<title>${esc(title)} · Visite 360°</title>
<style>
html,body{margin:0;height:100%;background:#0b100e;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#ece6da}
#c{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;touch-action:none}
#c:active{cursor:grabbing}
#fade{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;opacity:0;z-index:2}
#fade.on{opacity:1}
#fade.go{animation:through .55s cubic-bezier(.3,.6,.3,1) forwards}
@keyframes through{from{opacity:1;transform:scale(1);filter:blur(0)}to{opacity:0;transform:scale(1.18);filter:blur(6px)}}
#spots{position:absolute;inset:0;pointer-events:none;z-index:3}
.spot{position:absolute;left:0;top:0;display:flex;flex-direction:column;align-items:center;gap:6px;padding:0;border:0;background:none;color:#fff;cursor:pointer;opacity:0;transition:opacity .25s}
.disc{display:grid;place-items:center;width:58px;height:58px;border-radius:50%;border:2.5px solid rgba(255,255,255,.92);background:radial-gradient(circle,rgba(255,255,255,.34),rgba(255,255,255,.08) 70%);box-shadow:0 8px 22px rgba(0,0,0,.35);transform:perspective(320px) rotateX(52deg);transition:transform .25s,background .25s}
.spot:hover .disc{background:radial-gradient(circle,rgba(217,166,92,.95),rgba(217,166,92,.55) 75%);transform:perspective(320px) rotateX(40deg) scale(1.12)}
.label{padding:4px 11px;border-radius:999px;background:rgba(11,16,14,.62);font-size:13px;white-space:nowrap}
header{position:absolute;top:12px;left:12px;right:12px;z-index:4;display:flex;gap:10px;align-items:center;flex-wrap:wrap;pointer-events:none}
header>*{pointer-events:auto}
header strong{padding:7px 12px;border-radius:999px;background:rgba(11,16,14,.62);font-size:14px}
select,#fs{padding:7px 10px;border-radius:999px;border:1px solid rgba(236,230,218,.25);background:rgba(11,16,14,.62);color:#ece6da;font:inherit;font-size:14px}
#fs{margin-left:auto;cursor:pointer}
#hint{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);margin:0;padding:6px 12px;border-radius:999px;background:rgba(11,16,14,.62);font-size:13px;color:#b9c2bd;z-index:4;pointer-events:none;animation:hint .6s ease 5s forwards}
@keyframes hint{to{opacity:0}}
#load{position:absolute;inset:0;display:grid;place-items:center;color:#9aa59f;z-index:1}
#brand{position:absolute;right:12px;bottom:12px;z-index:4;font-size:11px;color:#9aa59f;text-decoration:none;opacity:.8}
</style>
</head>
<body>
<canvas id="c"></canvas><img id="fade" alt=""><div id="spots"></div><div id="load">Chargement de la visite…</div>
<header><strong id="t"></strong><select id="rooms" aria-label="Pièce"></select><button id="fs" type="button" aria-label="Plein écran">⛶</button></header>
<p id="hint">Faites glisser pour regarder autour</p>
<span id="brand">Visite 360° Roomia</span>
<script>
const DATA = ${data};
(function () {
  var c = document.getElementById('c'), fade = document.getElementById('fade'), spotsEl = document.getElementById('spots'), load = document.getElementById('load');
  document.getElementById('t').textContent = DATA.title;
  var gl = c.getContext('webgl', { preserveDrawingBuffer: true, antialias: false });
  if (!gl) { load.textContent = 'Ce navigateur ne peut pas afficher la visite 360°.'; return; }
  function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
  var prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}'));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, 'precision highp float;varying vec2 v;uniform sampler2D tex;uniform float yaw,pitch,th,asp;const float PI=3.14159265;void main(){vec2 q=v*2.-1.;vec3 d=normalize(vec3(q.x*th*asp,q.y*th,1.));float cp=cos(pitch),sp=sin(pitch);d=vec3(d.x,d.y*cp+d.z*sp,-d.y*sp+d.z*cp);float cy=cos(yaw),sy=sin(yaw);d=vec3(d.x*cy+d.z*sy,d.y,-d.x*sy+d.z*cy);float lon=atan(d.x,d.z);float lat=asin(clamp(d.y,-1.,1.));gl_FragColor=texture2D(tex,vec2(fract(.5+lon/(2.*PI)),.5-lat/PI));}'));
  gl.linkProgram(prog); gl.useProgram(prog);
  var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  var U = {}; ['yaw','pitch','th','asp'].forEach(function (k) { U[k] = gl.getUniformLocation(prog, k); });
  var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(function (w) { gl.texParameteri(gl.TEXTURE_2D, w, gl.CLAMP_TO_EDGE); });
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  var maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);

  var pts = DATA.points, byId = {}; pts.forEach(function (p) { byId[p.i] = p; });
  var cur = null, yaw = 0, pitch = 0, fov = 75, touched = false, anim = null, ready = false, goAfterDraw = false;
  var local = location.protocol === 'file:';

  // the picture of a point: the .jpg beside the page, or (opened from the disk) its data URL from visite-data/
  function picture(p, done) {
    function fromUrl(url) { var im = new Image(); im.onload = function () { done(im); }; im.onerror = function () { load.textContent = 'Image introuvable : ' + p.f; }; im.src = url; }
    if (!local) return fromUrl(encodeURIComponent(p.f));
    var have = window.ROOMIA_PANO && window.ROOMIA_PANO[p.k];
    if (have) return fromUrl(have);
    var s = document.createElement('script'); s.src = 'visite-data/' + p.k + '.js';
    s.onload = function () { fromUrl(window.ROOMIA_PANO[p.k]); }; s.onerror = function () { load.textContent = 'Fichier manquant : visite-data/' + p.k + '.js'; };
    document.head.appendChild(s);
  }
  function upload(im) {
    var src = im;
    if (im.naturalWidth > maxTex) { var cv = document.createElement('canvas'); cv.width = maxTex; cv.height = maxTex / 2; cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height); src = cv; }
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
  }
  // the way from one point to another (same as the Roomia tour): right (+) of where "from" looks, down to the floor where "to" stands
  function dir(from, to) {
    var fx = from.t[0] - from.p[0], fz = from.t[2] - from.p[2], vx = to.p[0] - from.p[0], vz = to.p[2] - from.p[2];
    var d = Math.hypot(vx, vz);
    return { yaw: Math.atan2(fx * vz - fz * vx, fx * vx + fz * vz), pitch: Math.atan2(to.p[1] - 1.25 - from.p[1], d), d: d };
  }
  function arrows(p) {
    var linked = p.l && p.l.length ? p.l : null;
    return pts.filter(function (q) { return q !== p && (!linked || linked.indexOf(q.i) >= 0); })
      .map(function (q) { var s = dir(p, q); s.q = q; return s; }).filter(function (s) { return s.d <= 9; })
      .sort(function (a, b) { return a.d - b.d; }).slice(0, 5);
  }
  var spotNodes = [];
  function show(p, arrivalYaw, through) {
    picture(p, function (im) {
      upload(im); cur = p; ready = true; load.style.display = 'none';
      yaw = arrivalYaw != null ? arrivalYaw : p.y; pitch = 0;
      // the snapshot starts fading only once the new point is drawn (a slow phone takes a moment to take a large picture)
      if (through) { anim = { f: { yaw: yaw, pitch: 0, fov: 54 }, t: { yaw: yaw, pitch: 0, fov: 75 }, t0: performance.now(), dur: 650 }; fov = 54; goAfterDraw = true; }
      rooms.value = String(p.i);
      spotsEl.innerHTML = ''; spotNodes = arrows(p).map(function (s) {
        var b = document.createElement('button'); b.className = 'spot'; b.type = 'button'; b.setAttribute('aria-label', 'Aller à ' + s.q.n);
        b.innerHTML = '<span class="disc"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 14.5 12 7.5l7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="label"></span>';
        b.querySelector('.label').textContent = s.q.n;
        b.style.pointerEvents = 'auto';
        b.onclick = function () { walk(s); };
        spotsEl.appendChild(b); return { el: b, s: s };
      });
    });
  }
  // through an arrow: turn and zoom towards it, keep the last frame, fade it over the next point (arriving facing the way one walked)
  function walk(s) {
    touched = true;
    var target = yaw + Math.atan2(Math.sin(s.yaw - yaw), Math.cos(s.yaw - yaw));
    anim = { f: { yaw: yaw, pitch: pitch, fov: fov }, t: { yaw: target, pitch: Math.max(-.35, Math.min(.1, s.pitch * .5)), fov: Math.max(38, fov * .6) }, t0: performance.now(), dur: 420, done: function () {
      draw(); fade.src = c.toDataURL('image/jpeg', .82); fade.classList.remove('go'); fade.classList.add('on');
      var a = arrival(cur, s.q); show(s.q, a, true);
    } };
  }
  function arrival(from, to) {
    var fx = to.t[0] - to.p[0], fz = to.t[2] - to.p[2], vx = to.p[0] - from.p[0], vz = to.p[2] - from.p[2];
    return Math.hypot(vx, vz) < .05 ? null : Math.atan2(fx * vz - fz * vx, fx * vx + fz * vz);
  }
  fade.addEventListener('animationend', function () { fade.classList.remove('on', 'go'); });

  var rooms = document.getElementById('rooms');
  pts.forEach(function (p) { var o = document.createElement('option'); o.value = String(p.i); o.textContent = p.n; rooms.appendChild(o); });
  rooms.onchange = function () { touched = true; show(byId[Number(rooms.value)]); };
  document.getElementById('fs').onclick = function () { var d = document; if (d.fullscreenElement) d.exitFullscreen(); else (d.documentElement.requestFullscreen || function () {}).call(d.documentElement); };

  // drag to look, wheel or pinch to zoom
  var pointers = {}, pinch = 0;
  c.addEventListener('pointerdown', function (e) { touched = true; pointers[e.pointerId] = { x: e.clientX, y: e.clientY }; c.setPointerCapture(e.pointerId); });
  c.addEventListener('pointermove', function (e) {
    var last = pointers[e.pointerId]; if (!last) return;
    var ids = Object.keys(pointers);
    if (ids.length === 2) {
      var a = pointers[ids[0]], b = pointers[ids[1]], before = Math.hypot(a.x - b.x, a.y - b.y);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      a = pointers[ids[0]]; b = pointers[ids[1]]; var after = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch && before > 0) fov = Math.min(100, Math.max(35, fov * before / after)); pinch = after; return;
    }
    var per = 2 * Math.tan(fov / 2 * Math.PI / 180) / Math.max(1, c.clientHeight);
    yaw -= (e.clientX - last.x) * per; pitch = Math.min(1.45, Math.max(-1.45, pitch + (e.clientY - last.y) * per));
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
  });
  function up(e) { delete pointers[e.pointerId]; pinch = 0; }
  c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  c.addEventListener('wheel', function (e) { e.preventDefault(); touched = true; fov = Math.min(100, Math.max(35, fov + e.deltaY * .04)); }, { passive: false });

  function draw() {
    var w = c.clientWidth, h = c.clientHeight, r = Math.min(devicePixelRatio || 1, 2);
    if (c.width !== Math.round(w * r) || c.height !== Math.round(h * r)) { c.width = Math.round(w * r); c.height = Math.round(h * r); }
    gl.viewport(0, 0, c.width, c.height);
    var th = Math.tan(fov / 2 * Math.PI / 180), asp = w / Math.max(1, h);
    gl.uniform1f(U.yaw, yaw); gl.uniform1f(U.pitch, pitch); gl.uniform1f(U.th, th); gl.uniform1f(U.asp, asp);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    spotNodes.forEach(function (n) {
      var x = Math.cos(n.s.pitch) * Math.sin(n.s.yaw), y = Math.sin(n.s.pitch), z = Math.cos(n.s.pitch) * Math.cos(n.s.yaw);
      var x1 = x * cy - z * sy, z1 = x * sy + z * cy, y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
      var sx = x1 / (z2 * th * asp), syy = y2 / (z2 * th), vis = z2 > .05 && Math.abs(sx) < .92 && Math.abs(syy) < .9;
      n.el.style.opacity = vis ? '1' : '0'; n.el.style.pointerEvents = vis ? 'auto' : 'none';
      if (vis) n.el.style.transform = 'translate(-50%,-50%) translate(' + ((sx + 1) / 2 * w) + 'px,' + ((1 - syy) / 2 * h) + 'px)';
    });
  }
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame() {
    if (anim) {
      var t = Math.min(1, (performance.now() - anim.t0) / anim.dur), k = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      yaw = anim.f.yaw + (anim.t.yaw - anim.f.yaw) * k; pitch = anim.f.pitch + (anim.t.pitch - anim.f.pitch) * k; fov = anim.f.fov + (anim.t.fov - anim.f.fov) * k;
      if (t >= 1) { var done = anim.done; anim = null; if (done) done(); }
    }
    if (ready && !touched && !reduce) yaw += .0012;
    if (ready) draw();
    if (goAfterDraw) { goAfterDraw = false; requestAnimationFrame(function () { fade.classList.add('go'); }); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  if (pts.length) show(pts[0]); else load.textContent = 'Cette visite n’a pas encore de 360°.';
})();
</script>
</body>
</html>
`
}
