// SPDX-License-Identifier: GPL-3.0-or-later
// Every module the HUD can show, by id. A module is an object with id, title, mount() and a few
// optional parts (see modules/common.js and grid.js for what the grid calls).
import character from './character.js';
import skills from './skills.js';
import industry from './industry.js';
import market from './market.js';
import chat from './chat.js';
import map from './map.js';
import warfare from './warfare.js';
import activity from './activity.js';
import mining from './mining.js';
import assets from './assets.js';
import standings from './standings.js';
import kills from './kills.js';

// in this order in Settings → Modules
export const REGISTRY = Object.fromEntries(
  [character, skills, map, chat, industry, market, warfare, activity, mining, assets, standings, kills].map(
    (m) => [m.id, m],
  ),
);
