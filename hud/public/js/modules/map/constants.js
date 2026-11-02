// SPDX-License-Identifier: GPL-3.0-or-later
// The star map's fixed tables: distances, faction groups and their colours, hazard kinds, colour
// modes and route choices.

export const LY = 946.073; // map units (1e13 m) per light year
export const NEIGHBOUR_JUMPS = 3;

// Region colouring: every region gets its own hue, spread around the colour wheel (golden angle),
// so neighbouring regions look different. The colours have no meaning of their own.
export const regionHue = (ri) => (ri * 137.508 + 160) % 360;

// Faction colouring: who controls each system (ESI /sovereignty/map, plus live Faction Warfare occupation).
// Groups are listed in the legend in this order; `ids` are ESI faction IDs.
export const FACTION_GROUPS = [
  { key: 'amarr', label: 'Amarr Empire', color: '#e2b84f', ids: [500003] },
  { key: 'ammatar', label: 'Ammatar · Khanid', color: '#a7873f', ids: [500007, 500008] },
  { key: 'caldari', label: 'Caldari State', color: '#4fa3d6', ids: [500001] },
  { key: 'gallente', label: 'Gallente Federation', color: '#52c48a', ids: [500004] },
  { key: 'minmatar', label: 'Minmatar Republic', color: '#d4573a', ids: [500002] },
  { key: 'thukker', label: 'Thukker Tribe', color: '#e8913f', ids: [500015] },
  { key: 'concord', label: 'CONCORD · Jove', color: '#d6e6ec', ids: [500006, 500005] },
  { key: 'pochven', label: 'Triglavian (Pochven)', color: '#b3263f', ids: [500026] },
  { key: 'npc', label: 'NPC / pirate null-sec', color: '#9a86d6' }, // any other NPC faction
  { key: 'alliance', label: 'Player alliances', color: '#d46fc0' }, // shades vary per alliance
  { key: 'none', label: 'Unclaimed', color: '#4c5458' },
];
export const GROUP_BY_FACTION = new Map(FACTION_GROUPS.flatMap((g) => (g.ids || []).map((id) => [id, g])));
export const GROUP = Object.fromEntries(FACTION_GROUPS.map((g) => [g.key, g]));
export const isFaction = (id) => id >= 500000 && id < 600000;
export function groupOf(ownerId) {
  if (!ownerId) return GROUP.none;
  if (isFaction(ownerId)) return GROUP_BY_FACTION.get(ownerId) || GROUP.npc;
  return GROUP.alliance;
}

export const COLOUR_MODES = [
  ['security', 'Security'],
  ['faction', 'Faction'],
  ['region', 'Region'],
];

// Hazard overlay: one pulsing diamond outline per kind of event, nested in this order (innermost first).
export const HAZARDS = {
  incursion: { label: 'Incursion', color: '#ff4a3d', help: 'Sansha incursion: NPC fleets in these systems' },
  kills: {
    label: 'Player kills (last hour)',
    color: '#ff9a3c',
    help: 'Ships and pods destroyed by players in the last hour',
  },
  sov: {
    label: 'Sovereignty fight',
    color: '#c084ff',
    help: 'Sovereignty structures under attack (null-sec)',
  },
  fw: {
    label: 'Faction Warfare frontline',
    color: '#f2e15a',
    help: 'Contested or vulnerable Faction Warfare systems',
  },
  campaign: {
    label: 'Military campaign',
    color: '#6fd0ff',
    help: 'Systems named in active military campaign objectives',
  },
};

export const ROUTE_PREFS = [
  ['shorter', 'Shorter'],
  ['safer', 'Safer'],
  ['insecure', 'Less secure'],
];
