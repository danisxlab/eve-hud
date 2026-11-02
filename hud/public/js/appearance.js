// SPDX-License-Identifier: GPL-3.0-or-later
// Settings → Appearance applied to the page: module opacity, blur, scanlines, animations.

import { store } from './store.js';

// ---------------- appearance ----------------
export function applyAppearance() {
  const a = store.settings.appearance;
  const root = document.documentElement.style;
  root.setProperty('--panel-alpha', String(a.opacity));
  root.setProperty('--panel-blur', `${a.blur}px`);
  // blur 0: no backdrop filter at all (not even the saturation), the cheapest for the graphics card
  if (Number(a.blur) > 0) root.removeProperty('--panel-backdrop');
  else root.setProperty('--panel-backdrop', 'none');
  root.setProperty('--gap', `${store.settings.grid.gap}px`);
  document.body.classList.toggle('scanlines', a.scanlines);
  document.body.classList.toggle('locked', store.settings.locked);
  // Animations: 'on' = Full, every effect at full smoothness (the default), 'limited' animates at a
  // few frames a second (much less CPU), 'off' never does. (An older 'system' choice counts as Full.)
  const mode = a.motion || 'on';
  const reduce = mode === 'off';
  document.body.classList.toggle('reduce-motion', reduce);
  document.body.classList.toggle('limited-motion', !reduce && mode === 'limited');
  document.body.classList.toggle('sk-light', a.trainingLight === true); // off by default
  repaintPlexus?.();
}
let repaintPlexus = null; // shows/hides (and draws) the plexus background, set in main()
export function setPlexusRepaint(fn) {
  repaintPlexus = fn;
}
