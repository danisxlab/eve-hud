// SPDX-License-Identifier: GPL-3.0-or-later
// Glow sprites for the star map: a small soft dot per colour, drawn once and reused.

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const spriteCache = new Map();
export function glowSprite(color) {
  if (spriteCache.has(color)) return spriteCache.get(color);
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, color.replace('ALPHA', '0.9'));
  grad.addColorStop(0.18, color.replace('ALPHA', '0.45'));
  grad.addColorStop(0.5, color.replace('ALPHA', '0.08'));
  grad.addColorStop(1, color.replace('ALPHA', '0'));
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  spriteCache.set(color, c);
  return c;
}
