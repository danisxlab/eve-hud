// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal line glyphs (24x24 grid, 1.4 stroke) in the spirit of EVE's Neocom icons.
const s = (body, fill = false) =>
  `<svg viewBox="0 0 24 24" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="1.4" stroke-linecap="square" stroke-linejoin="miter">${body}</svg>`;

export const ICONS = {
  brand: s(
    '<path d="M12 2.5 20.5 7.4v9.2L12 21.5 3.5 16.6V7.4z"/><circle cx="12" cy="12" r="3"/><path d="M12 2.5V7M12 17v4.5"/>',
  ),
  character: s('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-4 3.6-6 7-6s6.2 2 7 6"/>'),
  skills: s('<path d="M4 6l5 6-5 6M11 6l5 6-5 6M18 6v12"/>'),
  map: s(
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/>',
  ),
  chat: s('<path d="M4 5h16v10H10l-4 4v-4H4z"/>'),
  industry: s('<path d="M3 20V9l5 3V9l5 3V5h3v15zM3 20h18M18 20V12"/>'),
  manufacturing: s('<path d="M3 20V9l5 3V9l5 3V5h3v15zM3 20h18"/>', false),
  research: s(
    '<path d="M9 3h6M10 3v6l-5 9.5c-.5 1 .2 2.5 1.4 2.5h11.2c1.2 0 1.9-1.5 1.4-2.5L14 9V3M7.5 15h9"/>',
  ),
  copy: s('<path d="M8 8h11v12H8zM5 16V4h11"/>'),
  invention: s(
    '<circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="9" ry="3.5"/><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.5" transform="rotate(-60 12 12)"/>',
  ),
  reaction: s(
    '<circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/><path d="M9.5 9.5l5 5M17 4v6M7 14v6"/>',
  ),
  market: s('<path d="M4 19h16M6 16V11M10 16V7M14 16v-5M18 16V5"/>'),
  objectives: s(
    '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  ),
  freelance: s('<path d="M5 6l7 7 7-7M5 12l7 7 7-7"/>'),
  campaign: s('<path d="M6 21V4M6 4h11l-2.5 4L17 12H6"/>'),
  alert: s('<path d="M12 3 22 20H2z"/><path d="M12 10v4M12 16.5v.5"/>'),
  clock: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>'),
  settings: s(
    '<path d="M10.37 5.19 L10.78 2.88 L13.22 2.88 L13.63 5.19 L15.66 6.03 L17.58 4.69 L19.31 6.42 L17.97 8.34 L18.81 10.37 L21.12 10.78 L21.12 13.22 L18.81 13.63 L17.97 15.66 L19.31 17.58 L17.58 19.31 L15.66 17.97 L13.63 18.81 L13.22 21.12 L10.78 21.12 L10.37 18.81 L8.34 17.97 L6.42 19.31 L4.69 17.58 L6.03 15.66 L5.19 13.63 L2.88 13.22 L2.88 10.78 L5.19 10.37 L6.03 8.34 L4.69 6.42 L6.42 4.69 L8.34 6.03Z"/><circle cx="12" cy="12" r="3"/>',
  ),
  info: s(
    '<circle cx="12" cy="12" r="9"/><path d="M12 10.5v6.5"/><circle cx="12" cy="7.4" r="0.9" fill="currentColor" stroke="none"/>',
  ),
  lock: s('<path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>'),
  unlock: s('<path d="M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  minus: s('<path d="M5 12h14"/>'),
  center: s('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>'), // ◎
  lanes: s(
    '<circle cx="5" cy="17" r="1.6"/><circle cx="12" cy="7" r="1.6"/><circle cx="19" cy="15" r="1.6"/><path d="M6 15.5l5-7M13.4 8.2l4.6 5.6"/>',
  ),
  layout: s(
    '<rect x="3.5" y="3.5" width="5" height="5" rx="1"/><rect x="15.5" y="3.5" width="5" height="5" rx="1"/><rect x="9.5" y="15.5" width="5" height="5" rx="1"/><path d="M8.5 6h7M7.5 8.5l3.2 7M16.5 8.5l-3.2 7"/>',
  ),
  palette: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M3.5 12h8.5"/>'),
  refresh: s('<path d="M19 12a7 7 0 1 1-2.05-4.95M19 4v4h-4"/>'),
  ship: s('<path d="M12 3l3 9-3 9-3-9z"/><path d="M5 14l4-2M19 14l-4-2"/>'),
  // under attack: target brackets with an impact burst in the middle (the top bar's ATTACK)
  attack: s(
    '<path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5"/><path d="M12 6.5v3.5M12 14v3.5M6.5 12H10M14 12h3.5M8.6 8.6l2 2M15.4 15.4l-2-2M15.4 8.6l-2 2M8.6 15.4l2-2"/>',
  ),
  warfare: s(
    '<path d="M4 4l9 9M4 4v3.5M4 4h3.5M20 4l-9 9M20 4v3.5M20 4h-3.5M7.5 14.5 4 18l2 2 3.5-3.5M16.5 14.5 20 18l-2 2-3.5-3.5"/>',
  ),
  // dot with three broadcast arcs above it (EVE's notification symbol)
  notifications: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="17" r="2.1" fill="currentColor" stroke="none"/><path d="M8.6 13.6a4.8 4.8 0 0 1 6.8 0"/><path d="M6.1 11.1a8.4 8.4 0 0 1 11.8 0"/><path d="M3.6 8.6a12 12 0 0 1 16.8 0"/></svg>`,
  mail: s('<path d="M3 6h18v12H3z"/><path d="M3 6l9 7 9-7"/>'),
  hazard: s('<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/><path d="M12 8v5M12 15.5v.5"/>'),
  goals: s('<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M8.5 12.5l2.4 2.4 4.6-5"/>'),
  // optional modules
  activity: s('<path d="M3 17l5-5 4 3 8-8"/><path d="M15 7h5v5"/><path d="M3 21h18"/>'),
  mining: s(
    '<path d="M4 20l7-7"/><path d="M9 6c3-2.5 7-2.5 10 0-1.5.5-3 1.5-4 3l-3-3"/><path d="M14 9l-2 2"/>',
  ),
  assets: s('<path d="M4 8l8-4 8 4-8 4z"/><path d="M4 8v8l8 4 8-4V8"/><path d="M12 12v8"/>'),
  standings: s(
    '<path d="M12 3v18"/><path d="M5 7h14"/><path d="M5 7l-2.5 6h5zM19 7l-2.5 6h5z"/><path d="M8 21h8"/>',
  ),
  kills: s(
    '<circle cx="12" cy="12" r="7.5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
  ),
  route: s(
    '<circle cx="5.5" cy="18.5" r="2"/><circle cx="18.5" cy="5.5" r="2"/><path d="M7.5 18.5h6a3 3 0 0 0 0-6h-3a3 3 0 0 1 0-6h6"/>',
  ),
};
