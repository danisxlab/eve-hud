// SPDX-License-Identifier: GPL-3.0-or-later
// The slow starfield behind the modules, so the see-through panels have depth.

import { $, motionReduced, motionLimited, onFrame } from './util.js';
import { store } from './store.js';

// ---------------- backdrop: slow starfield so translucent panels have depth ----------------
export function startBackdrop() {
  const c = $('#backdrop');
  const g = c.getContext('2d');
  let W,
    H,
    stars = [],
    nebula = null;
  const resize = () => {
    // On a Retina / HiDPI screen (2× or more) the starfield is drawn at normal density: a quarter of
    // the pixels, and you can't tell behind the see-through panels. Other screens: as before.
    const screenDpr = devicePixelRatio || 1;
    const dpr = screenDpr >= 2 ? 1 : Math.min(2, screenDpr);
    W = innerWidth;
    H = innerHeight;
    c.width = W * dpr;
    c.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // stars in 0..1 coordinates: a resize (or full screen) keeps them where they are, stretched,
    // and only adds or drops a few for the new size
    const want = Math.round((W * H) / 2600);
    while (stars.length < want)
      stars.push({ x: Math.random(), y: Math.random(), z: Math.random(), p: Math.random() * Math.PI * 2 });
    stars.length = want;
    // the two faint faction-coloured nebula washes never change: drawn once per size, then copied
    nebula = document.createElement('canvas');
    nebula.width = c.width;
    nebula.height = c.height;
    const ng = nebula.getContext('2d');
    ng.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n1 = ng.createRadialGradient(W * 0.18, H * 0.3, 0, W * 0.18, H * 0.3, W * 0.9);
    n1.addColorStop(0, 'rgba(79,176,143,0.07)');
    n1.addColorStop(1, 'rgba(79,176,143,0)');
    ng.fillStyle = n1;
    ng.fillRect(0, 0, W, H);
    const n2 = ng.createRadialGradient(W * 0.85, H * 0.78, 0, W * 0.85, H * 0.78, W * 0.8);
    n2.addColorStop(0, 'rgba(79,163,214,0.06)');
    n2.addColorStop(1, 'rgba(79,163,214,0)');
    ng.fillStyle = n2;
    ng.fillRect(0, 0, W, H);
  };
  addEventListener('resize', resize);
  resize();
  // The stars drift slowly, so they're redrawn about 10 times a second (once a second with
  // animations off), not every frame: that also spares the blurred panels in front of them, which
  // the graphics card has to blur again every time the stars behind them change.
  let last = -Infinity;
  let lastSlot = -1;
  const draw = (t) => {
    const every = motionReduced() ? 1000 : motionLimited() ? 500 : 100;
    const slot = Math.floor(t / every); // about every third tick of the shared clock
    if (slot === lastSlot) return;
    lastSlot = slot;
    const dt = Math.min(1000, t - (Number.isFinite(last) ? last : t - every)); // ms since the last draw
    last = t;
    const mode = store.settings?.appearance.backdrop || 'stars';
    g.clearRect(0, 0, W, H);
    if (mode !== 'none') {
      g.drawImage(nebula, 0, 0, W, H);
      const still = motionReduced();
      const step = dt / 16.7; // the drift speeds were per 60 Hz frame
      for (const s of stars) {
        if (!still) {
          s.y += ((0.004 + s.z * 0.012) * step) / H;
          if (s.y > 1) {
            s.y = 0;
            s.x = Math.random();
          }
        }
        const a = 0.15 + s.z * 0.5 + (still ? 0 : Math.sin(t / 1300 + s.p) * 0.12);
        g.fillStyle = `rgba(200,220,230,${a})`;
        const r = s.z > 0.92 ? 1.4 : 0.8;
        g.fillRect(s.x * W, s.y * H, r, r);
      }
    }
  };
  addEventListener('resize', () => {
    last = -Infinity;
    lastSlot = -1;
  }); // redraw at once after a resize
  onFrame(draw);
}
