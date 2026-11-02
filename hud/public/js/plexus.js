// SPDX-License-Identifier: GPL-3.0-or-later
// Plexus background: a low-poly constellation mesh (points linked by thin lines, some triangles
// filled with a faint translucent face). Busy and bright in the bottom-right corner, thinning out
// towards the top left, where it's gone. It scales with the window.
//
// Animated (Settings → Appearance → "Animate background", off by default): every point
// wanders slowly around its place, so lines and triangles come and go. Nothing pops: each line and
// face fades in and out over about three seconds, and every face glows and dims on its own slow
// rhythm. A few faces are a deeper green or a pale mint. It's redrawn 30 times a second (Animations: Full), 24 times a second
// (Limited), or not at all (Off, or the switch off: then it stands still).
//
// The layout comes from a fixed seed, so it looks the same every time you open the HUD.

import { onFrame, motionReduced, motionLimited } from './util.js';

const SEED = 0x5eed42;

// small seeded random generator (mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
// 0 in the top-left corner, 1 in the bottom-right one
const along = (x, y) => x * 0.55 + y * 0.45;

// Points in 0..1 coordinates, denser towards the bottom right, with a few loose clusters there for
// a slightly chaotic look. A minimum distance keeps them from clumping. Each point gets its own slow
// wander (two sine waves per axis, 60 to 150 seconds long).
function makePoints(count) {
  const r = rng(SEED);
  const pts = [];
  const clusters = Array.from({ length: 4 }, () => ({
    x: 0.6 + r() * 0.4,
    y: 0.5 + r() * 0.5,
    s: 0.08 + r() * 0.08,
  }));
  const minD = 0.55 / Math.sqrt(count);
  let guard = 0;
  while (pts.length < count && guard++ < count * 80) {
    let x;
    let y;
    if (r() < 0.18) {
      // around a cluster (Box-Muller)
      const c = clusters[Math.floor(r() * clusters.length)];
      const m = Math.sqrt(-2 * Math.log(Math.max(1e-6, r()))) * c.s;
      const a = r() * Math.PI * 2;
      x = c.x + Math.cos(a) * m;
      y = c.y + Math.sin(a) * m;
    } else {
      x = r() * 1.1 - 0.05;
      y = r() * 1.1 - 0.05;
    }
    if (x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05) continue;
    if (r() > Math.pow(smooth(0.05, 1.1, along(x, y)), 1.25)) continue;
    // closer together in the busy corner, further apart where it thins out
    const near = minD * (1.75 - along(x, y));
    if (
      pts.some(
        (p) => Math.abs(p.x - x) < near && Math.abs(p.y - y) < near && Math.hypot(p.x - x, p.y - y) < near,
      )
    )
      continue;
    const per = () => (2 * Math.PI) / (60 + r() * 90); // radians per second: 60 to 150 s per wave
    pts.push({
      x,
      y,
      k: r(),
      f: r(),
      w: [per(), per(), per(), per()],
      ph: [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28],
      amp: 0.5 + r() * 0.5,
      z: r(),
      wz: per(),
      pz: r() * 6.28,
    });
  }
  return pts;
}

// a stable 0..1 value for a pair or triple of point indices (which face gets a tint, which line...)
const hash = (...ids) => {
  let x = 0x811c9dc5;
  for (const id of ids) {
    x ^= id + 0x9e3779b9;
    x = Math.imul(x, 16777619) >>> 0;
    x ^= x >>> 13;
  }
  return (Math.imul(x, 2246822519) >>> 0) / 4294967296;
};

// Delaunay triangulation (Bowyer-Watson): the triangles of a low-poly mesh, none overlapping.
// Returns [i, j, k] index triples into pts ({px, py}).
function triangulate(pts) {
  const n = pts.length;
  const xs = pts.map((p) => p.px);
  const ys = pts.map((p) => p.py);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const d = Math.max(maxX - minX, maxY - minY) * 20;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const P = [...pts.map((p) => [p.px, p.py]), [cx - d, cy - d], [cx + d, cy - d], [cx, cy + d]];
  const circum = (a, b, c) => {
    const [ax, ay] = P[a];
    const [bx, by] = P[b];
    const [cx2, cy2] = P[c];
    const D2 = 2 * (ax * (by - cy2) + bx * (cy2 - ay) + cx2 * (ay - by)) || 1e-12;
    const ux =
      ((ax * ax + ay * ay) * (by - cy2) +
        (bx * bx + by * by) * (cy2 - ay) +
        (cx2 * cx2 + cy2 * cy2) * (ay - by)) /
      D2;
    const uy =
      ((ax * ax + ay * ay) * (cx2 - bx) +
        (bx * bx + by * by) * (ax - cx2) +
        (cx2 * cx2 + cy2 * cy2) * (bx - ax)) /
      D2;
    return { a, b, c, x: ux, y: uy, r2: (ax - ux) ** 2 + (ay - uy) ** 2 };
  };
  let tris = [circum(n, n + 1, n + 2)];
  for (let i = 0; i < n; i++) {
    const [px, py] = P[i];
    const edges = new Map();
    const keep = [];
    for (const t of tris) {
      if ((px - t.x) ** 2 + (py - t.y) ** 2 < t.r2) {
        for (const [u, v] of [
          [t.a, t.b],
          [t.b, t.c],
          [t.c, t.a],
        ]) {
          const key = u < v ? `${u},${v}` : `${v},${u}`;
          edges.set(key, edges.has(key) ? null : [u, v]); // an edge shared by two removed triangles goes
        }
      } else keep.push(t);
    }
    for (const e of edges.values()) if (e) keep.push(circum(e[0], e[1], i));
    tris = keep;
  }
  return tris.filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c]);
}

// colours (r,g,b): the HUD's green family
const C = {
  base: '79,176,143', // faces and the corner glow
  deep: '38,196,118', // a few faces: deeper, more saturated green
  mint: '176,240,212', // a few faces: pale mint
  line: '112,204,168',
  web: '150,226,196',
  dot: '160,226,200',
  star: '232,255,244',
};
const STEPS = 256; // opacity steps for batching, finer at low opacity (square root), so slow fades don't step

// the halo of a bright point, drawn once
const halo = (() => {
  const c = document.createElement('canvas');
  c.width = 36;
  c.height = 36;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(18, 18, 0, 18, 18, 18);
  gr.addColorStop(0, `rgba(${C.web},0.32)`);
  gr.addColorStop(1, `rgba(${C.web},0)`);
  x.fillStyle = gr;
  x.fillRect(0, 0, 36, 36);
  return c;
})();

const MAX_POINTS = 380;
let ALL = null; // the points for the biggest window; smaller ones use the first part

export function createPlexus(canvas) {
  const g = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let base = [];
  let D = 100;
  let wander = 30;
  const lines = new Map(); // key -> shown strength 0..1, eased towards its target every frame
  const faces = new Map();
  let tris = null;
  let trisAt = 0;
  let webOrder = [];
  const web = new Map();
  // a faceted low-poly look: each face is lit by its slant (from the points' depth), light from
  // the top left. Subtle: 0.35 (turned away) .. about 1.6 (facing the light)
  let depth = 60;
  const facet = (a, b, c) => {
    const ux = b.px - a.px;
    const uy = b.py - a.py;
    const uz = (b.pz - a.pz) * depth;
    const vx = c.px - a.px;
    const vy = c.py - a.py;
    const vz = (c.pz - a.pz) * depth;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    if (nz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const n = Math.hypot(nx, ny, nz) || 1;
    const lit = (nx * -0.45 + ny * -0.55 + nz * 0.7) / n / 1.0;
    return 0.35 + Math.max(0, lit) * 1.25;
  };

  function resize() {
    W = innerWidth;
    H = innerHeight;
    // like the starfield: on a 2x screen, normal density (you can't tell behind the panels)
    const dpr = (devicePixelRatio || 1) >= 2 ? 1 : Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Always the same points, of which a bigger window shows more: a resize (or full screen) keeps
    // the mesh as it is, stretched, instead of starting it over
    ALL ||= makePoints(MAX_POINTS);
    const count = Math.round(Math.min(MAX_POINTS, Math.max(110, (W * H) / 5200)));
    base = ALL.slice(0, count);
    // for the web lines: each bright point tries the others in its own fixed order
    webOrder = base.map((p, i) =>
      p.k > 0.92
        ? base
            .map((_, j) => j)
            .filter((j) => j !== i)
            .sort((x, y) => hash(i, x, 11) - hash(i, y, 11))
        : [],
    );
    D = Math.max(70, Math.sqrt(W * H) / 9); // longest line: longer ones fade out
    wander = Math.max(16, Math.sqrt(W * H) / 40); // how far a point drifts from its place
    // keep what's shown; only lines and faces with points this size doesn't have fade away
    for (const map of [lines, faces, web])
      for (const [key, e] of map) if (e.ids.some((i) => i >= count)) map.delete(key);
    tris = null;
    depth = D * 0.9; // how deep the mesh is, in pixels
  }

  // ease the shown strength of each line / face towards this frame's target; gone ones fade to 0.
  // map: numeric key -> { ids, cur, to }
  function ease(map, k) {
    for (const [key, e] of map) {
      e.cur += (e.to - e.cur) * k;
      if (e.to === 0 && e.cur < 0.003) map.delete(key);
      e.to = 0; // until this frame's targets set it again
    }
  }
  const target = (map, key, ids, to, k) => {
    const e = map.get(key);
    if (e) e.to = to;
    else map.set(key, { ids, cur: k >= 1 ? to : 0, to });
  };

  // t: seconds; k: easing step (1 = jump straight to the target, for a still picture)
  function draw(t, k) {
    const pts = base.map((p) => {
      // depth: z 0 (far) .. 1 (near), slowly rising and sinking; near points drift a little more
      const z = Math.min(1, Math.max(0, p.z + Math.sin(t * p.wz + p.pz) * 0.18));
      const par = 0.65 + 0.6 * z;
      const dx =
        (Math.sin(t * p.w[0] + p.ph[0]) * 0.7 + Math.sin(t * p.w[1] + p.ph[1]) * 0.3) * wander * p.amp * par;
      const dy =
        (Math.sin(t * p.w[2] + p.ph[2]) * 0.7 + Math.sin(t * p.w[3] + p.ph[3]) * 0.3) * wander * p.amp * par;
      const px = p.x * W + dx;
      const py = p.y * H + dy;
      return { ...p, px, py, pz: z, fade: Math.pow(smooth(0.12, 1.0, along(px / W, py / H)), 1.3) };
    });
    const len = (i, j) => Math.hypot(pts[i].px - pts[j].px, pts[i].py - pts[j].py);
    // the points move slowly: the triangulation is redone every half second, not every frame
    if (!tris || k >= 1 || t - trisAt > 0.5 || t < trisAt) {
      tris = triangulate(pts).map((tri) => {
        const [x, y, z] = tri.sort((m, n) => m - n);
        return Object.assign([x, y, z], { key: (x * 4096 + y) * 4096 + z, hash: hash(x, y, z) });
      });
      trisAt = t;
    }

    // what should be visible now: lines (Delaunay edges shorter than D) and faces
    for (const tri of tris) {
      let weakest = 1;
      for (let m = 0; m < 3; m++) {
        const u = Math.min(tri[m], tri[(m + 1) % 3]);
        const v = Math.max(tri[m], tri[(m + 1) % 3]);
        const l = len(u, v);
        const s = l < D ? Math.pow(1 - l / D, 0.9) : 0;
        if (s < weakest) weakest = s;
        if (s > 0) target(lines, u * 4096 + v, [u, v], s, k);
      }
      if (tri.hash < 0.4 && weakest > 0.12) target(faces, tri.key, tri, Math.min(1, weakest * 2.2), k);
    }
    ease(lines, k);
    ease(faces, k);

    g.clearRect(0, 0, W, H);
    // a soft glow in the busy corner
    const glow = g.createRadialGradient(W, H, 0, W, H, Math.max(W, H) * 0.8);
    glow.addColorStop(0, `rgba(${C.base},0.05)`);
    glow.addColorStop(1, `rgba(${C.base},0)`);
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);

    // Everything is collected per colour and (rounded) opacity into a few paths, then drawn with
    // one fill or stroke each: a few dozen canvas calls a frame instead of thousands.
    const paths = new Map();
    const into = (color, a, build) => {
      const b = Math.round(Math.sqrt(Math.min(0.9, Math.max(0, a))) * STEPS);
      if (b <= 0) return;
      const key = `${color}|${b}`;
      let p = paths.get(key);
      if (!p) paths.set(key, (p = new Path2D()));
      build(p);
    };
    const flush = (mode) => {
      for (const [key, p] of paths) {
        const [color, b] = key.split('|');
        const alpha = ((b / STEPS) ** 2).toFixed(4);
        if (mode === 'fill') {
          g.fillStyle = `rgba(${color},${alpha})`;
          g.fill(p);
        } else {
          g.strokeStyle = `rgba(${color},${alpha})`;
          g.stroke(p);
        }
      }
      paths.clear();
    };

    // faces: most a faint green; a few a deeper, more saturated green, a few a pale mint
    for (const {
      ids: [a, b, c],
      cur: s,
    } of faces.values()) {
      const fade = (pts[a].fade + pts[b].fade + pts[c].fade) / 3;
      if (fade < 0.04) continue;
      const hh = hash(a, b, c, 7);
      // every face glows and dims very slowly on its own rhythm (12 to 30 s): a living mesh
      const breathe = 0.6 + 0.4 * Math.sin(t * ((2 * Math.PI) / (12 + hash(a, b, c, 5) * 18)) + hh * 40);
      let color = C.base;
      let alpha = (0.02 + Math.pow(hash(a, b, c, 3), 1.6) * 0.09) * breathe;
      if (hh > 0.95) {
        color = C.deep;
        alpha = (0.09 + (hh - 0.95) * 1.4) * breathe;
      } else if (hh > 0.91) {
        color = C.mint;
        alpha = (0.08 + (hh - 0.91) * 1.2) * breathe;
      }
      into(color, alpha * s * fade * facet(pts[a], pts[b], pts[c]), (p) => {
        p.moveTo(pts[a].px, pts[a].py);
        p.lineTo(pts[b].px, pts[b].py);
        p.lineTo(pts[c].px, pts[c].py);
        p.closePath();
      });
    }
    flush('fill');

    // lines: fainter the longer they are, and the further back; the near ones a little thicker
    for (const near of [false, true]) {
      g.lineWidth = near ? 0.85 : 0.6;
      for (const {
        ids: [u, v],
        cur: s,
      } of lines.values()) {
        const z = (pts[u].pz + pts[v].pz) / 2;
        if (z > 0.55 !== near) continue;
        const a = s * (0.28 + hash(u, v) * 0.32) * (0.5 + 0.6 * z) * Math.min(pts[u].fade, pts[v].fade);
        into(C.line, a, (p) => {
          p.moveTo(pts[u].px, pts[u].py);
          p.lineTo(pts[v].px, pts[v].py);
        });
      }
      flush('stroke');
    }

    // the plexus web: bright points reach out to some further points with long, faint lines; they
    // fade in and out with the distance, so they come and go smoothly too
    // (at most two from each bright point and one to any other point, so no star bursts)
    g.lineWidth = 0.55;
    const reached = new Set();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.k <= 0.92 || p.fade < 0.15) continue;
      let drawn = 0;
      for (const j of webOrder[i]) {
        if (drawn >= 2) break;
        if (reached.has(j)) continue;
        const q = pts[j];
        const l = Math.hypot(p.px - q.px, p.py - q.py);
        if (l < D * 0.6 || l > D * 1.9) continue;
        drawn += 1;
        reached.add(j);
        target(web, i * 4096 + j, [i, j], smooth(D * 0.6, D * 0.8, l) * smooth(D * 1.9, D * 1.5, l), k);
      }
    }
    ease(web, k); // a web line that changes partner fades over, like the mesh
    for (const {
      ids: [i, j],
      cur: s,
    } of web.values()) {
      const p = pts[i];
      const q = pts[j];
      into(C.web, s * 0.22 * Math.min(p.fade, q.fade), (path) => {
        path.moveTo(p.px, p.py);
        path.lineTo(q.px, q.py);
      });
    }
    flush('stroke');

    // the points; the bright ones get a halo (one small pre-drawn image)
    for (const p of pts) {
      if (p.fade < 0.03) continue;
      const big = p.k > 0.92;
      if (big) {
        g.globalAlpha = p.fade;
        g.drawImage(halo, p.px - 9, p.py - 9, 18, 18);
        g.globalAlpha = 1;
      }
      const rad = (big ? 1.7 : 0.6 + p.k * 0.8) * (0.75 + 0.5 * p.pz);
      into(big ? C.star : C.dot, (big ? 0.85 : 0.3 + p.f * 0.4) * (0.6 + 0.5 * p.pz) * p.fade, (path) => {
        path.moveTo(p.px + rad, p.py);
        path.arc(p.px, p.py, rad, 0, Math.PI * 2);
      });
    }
    flush('fill');
  }

  return { resize, draw };
}

// Starts it. on(): shown at all; animate(): the "Animate background" switch. Returns
// repaint(), to call after a settings change.
export function startPlexus(canvas, { on, animate }) {
  const px = createPlexus(canvas);
  let size = '';
  let still = null; // the time of the still picture, while it doesn't move
  const now = () => performance.now() / 1000;

  const repaint = () => {
    canvas.hidden = !on();
    if (canvas.hidden) return;
    const s = `${innerWidth}x${innerHeight}@${devicePixelRatio}`;
    const moving = animate() && !motionReduced();
    if (s !== size) {
      size = s;
      px.resize();
      still = null;
    }
    if (!moving && still === null) {
      still = now();
      px.draw(still, 1);
    } // a still picture, drawn once
    if (moving) still = null;
  };

  let timer = null;
  addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(repaint, 150);
  });
  repaint();

  // 30 frames a second with Animations: Full, 24 with Limited, on the HUD's shared clock (which only
  // wakes the page when a frame is due); nothing while it stands still or the window is hidden.
  let lastDraw = -Infinity;
  onFrame(
    (tms) => {
      if (canvas.hidden || !animate() || motionReduced()) {
        lastDraw = -Infinity;
        return;
      }
      const dt = Number.isFinite(lastDraw) ? Math.min(1000, tms - lastDraw) : 33;
      lastDraw = tms;
      px.draw(now(), 1 - Math.exp(-dt / 1600)); // lines and faces fade in and out over about 3 seconds
    },
    { fps: () => (motionLimited() ? 24 : 30) },
  );
  const run = () => {};
  const repaintAndRun = () => {
    repaint();
    run();
  };
  return repaintAndRun;
}
