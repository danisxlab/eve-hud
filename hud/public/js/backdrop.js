// SPDX-License-Identifier: GPL-3.0-or-later
// The slow starfield behind the modules, so the see-through panels have depth.

import { $, motionReduced, motionLimited, onFrame, FPS } from './util.js';
import { store } from './store.js';

// ---------------- backdrop: slow starfield so translucent panels have depth ----------------
export function startBackdrop() {
  const c = $('#backdrop');
  const g = c.getContext('2d');
  let W,
    H,
    stars = [];
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
    // (the two faint faction-coloured nebula washes behind the stars are a CSS background of this
    // canvas, base.css: they never change, and that way they need no window-sized picture)
  };
  addEventListener('resize', resize);
  resize();
  // The stars drift slowly, so they're redrawn about 12 times a second (twice with Animations:
  // Limited; with animations off only after a change), not every frame: that also spares the blurred panels in front of them, which
  // the graphics card has to blur again every time the stars behind them change.
  let last = -Infinity;
  let drawn = ''; // what the canvas shows while nothing moves
  // draws a second. Full: every second beat of the shared clock (12.5), so the stars need no
  // frames of their own between the other parts' frames.
  const rate = () => (motionReduced() ? 1 : motionLimited() ? 2 : FPS / 2);
  const draw = (t) => {
    const every = 1000 / rate();
    const mode = store.settings?.appearance.backdrop || 'stars';
    c.classList.toggle('none', mode === 'none');
    // nothing moves (animations off, or no stars): draw once, then only after a change
    const key = motionReduced() || mode === 'none' ? `${mode}|${W}|${H}` : '';
    if (key && key === drawn) return;
    drawn = key;
    const dt = Math.min(1000, t - (Number.isFinite(last) ? last : t - every)); // ms since the last draw
    last = t;
    g.clearRect(0, 0, W, H);
    if (mode !== 'none') {
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
    drawn = '';
    draw(performance.now()); // redraw at once after a resize (which empties the canvas)
  });
  // on the shared clock at its own, low rate: the page isn't woken for the frames in between
  onFrame(draw, { fps: rate });
}
