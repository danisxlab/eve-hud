// SPDX-License-Identifier: GPL-3.0-or-later
import { parseMessage } from './evehtml.js';
// Demo mode: plausible fake data so the HUD can be previewed without logging in.
// Run with: npm run demo
const H = 3600_000;
const D = 24 * H;

function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

const SYL = [
  'ja',
  'ri',
  'to',
  'lu',
  'ne',
  'ka',
  'vo',
  'es',
  'dra',
  'mi',
  'tal',
  'or',
  'en',
  'ish',
  'ul',
  'qa',
  'ze',
  'ro',
];

export function demoUniverse() {
  const r = rng(7);
  const regions = [];
  const systems = [];
  const jumps = [];
  let id = 30000001;
  const regionCount = 64;
  for (let ri = 0; ri < regionCount; ri++) {
    const ang = r() * Math.PI * 2;
    const rad = Math.pow(r(), 0.7) * 4.2e17;
    const cx = Math.cos(ang) * rad * 1.15;
    const cz = Math.sin(ang) * rad * 0.8 + 1.0e17;
    const rid = 10000001 + ri;
    regions.push({
      id: rid,
      name:
        SYL[ri % SYL.length].toUpperCase()[0] + SYL[(ri * 7) % SYL.length] + SYL[(ri * 3 + 1) % SYL.length],
    });
    const n = 50 + Math.floor(r() * 70);
    const start = systems.length;
    const highsec = rad < 2.0e17;
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2;
      const d = Math.pow(r(), 0.6) * 4.5e16;
      const name =
        `${'ABCDEFGHJKLMNPRSTUVXYZ'[Math.floor(r() * 22)]}${Math.floor(r() * 9)}${SYL[Math.floor(r() * SYL.length)]}`.toUpperCase();
      const sec = highsec ? 0.45 + r() * 0.55 : r() < 0.4 ? 0.1 + r() * 0.3 : -r();
      systems.push({
        id: id++,
        name,
        regionId: rid,
        x: cx + Math.cos(a) * d,
        y: 0,
        z: cz + Math.sin(a) * d,
        sec,
      });
    }
    for (let k = start + 1; k < systems.length; k++) {
      // connect each system to its nearest predecessor in the region
      let best = start;
      let bd = Infinity;
      for (let m = start; m < k; m++) {
        const dd = (systems[k].x - systems[m].x) ** 2 + (systems[k].z - systems[m].z) ** 2;
        if (dd < bd) {
          bd = dd;
          best = m;
        }
      }
      jumps.push([systems[best].id, systems[k].id]);
    }
  }
  // inter-region links: join each region to its nearest neighbouring region via the closest pair
  for (let ri = 1; ri < regionCount; ri++) {
    const mine = systems.filter((s) => s.regionId === 10000001 + ri);
    const others = systems.filter((s) => s.regionId < 10000001 + ri);
    let best = null;
    let bd = Infinity;
    for (const a of mine.filter((_, i) => i % 4 === 0)) {
      for (const b of others) {
        const dd = (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
        if (dd < bd) {
          bd = dd;
          best = [a.id, b.id];
        }
      }
    }
    if (best) jumps.push(best);
  }
  systems[0].name = 'Luminaire';
  systems[0].sec = 0.9;
  return { source: 'demo', regions, systems, jumps };
}

const SKILLS = [
  ['Mining Frigate', 4],
  ['Mining', 4],
  ['Astrogeology', 3],
  ['Drones', 4],
  ['Light Drone Operation', 4],
  ['Gallente Frigate', 3],
  ['Small Hybrid Turret', 3],
  ['Shield Operation', 3],
  ['Industry', 4],
  ['Reprocessing', 3],
];

export function createDemo(universe, publish) {
  const now = Date.now();
  const sys = universe.findByName('Luminaire') || universe.system(30000001);
  const pilots = [
    'Arvel Toor',
    'Kessa Vynn',
    'Mordu Hale',
    'Ishuk Lannet',
    'Ren Okaru',
    'Teodor Blanc',
    'Sora Ivanov',
  ];
  const lines = [
    'anyone selling scordite?',
    'o7',
    'Gate camp on the out gate, careful',
    'WTB hobgoblins',
    'Venture down in belt 3 lol',
    'thanks for the help!',
    'fleet forming for the ore site',
    'Is the market hub busy today?',
  ];
  const r = rng(42);

  const startSkill = now - 2.4 * H;
  let t = startSkill + 5.1 * H;
  const queue = SKILLS.map(([name, level], i) => {
    const dur = (1.5 + r() * 9) * H;
    const e = {
      skillId: 3386 + i,
      name,
      level,
      position: i,
      start: i === 0 ? startSkill : t,
      finish: i === 0 ? startSkill + 5.1 * H : t + dur,
      levelStartSp: 8000 * level,
      levelEndSp: 45255 * level,
      trainingStartSp: 8000 * level + 1200,
    };
    if (i > 0) t += dur;
    return e;
  });

  const balanceSeries = [];
  let bal = 2_670_294;
  for (let i = 30; i >= 0; i--) {
    bal += (r() - 0.35) * 220_000;
    balanceSeries.push([now - i * D, Math.max(150_000, bal)]);
  }

  const feeds = {
    status: {
      players: 23_481,
      version: '2987654',
      startTime: new Date(now - 3 * H).toISOString(),
      vip: false,
    },
    // ESI health: all fine, except the market orders route, to show an amber module light;
    // its status is the text in the hover boxes ("ESI Simulation"), so nobody takes it for real
    esihealth: {
      feeds: {
        status: 'ok',
        skills: 'ok',
        character: 'ok',
        wallet: 'ok',
        presence: 'ok',
        industry: 'ok',
        orders: 'degraded',
        warfare: 'ok',
        traffic: 'ok',
        hazards: 'ok',
        sovereignty: 'ok',
        route: 'ok',
      },
      problems: { orders: [{ route: 'GET /characters/{}/orders', status: 'Simulation' }] },
      routes: 180,
    },
    character: {
      id: 2112625428,
      name: 'Demo Capsuleer',
      securityStatus: 0.42,
      birthday: new Date(now - 34 * D).toISOString(),
      race: 'Gallente',
      gender: 'female',
      achievementScore: 1240,
      corporation: { id: 1000107, name: 'Federal Navy Academy', ticker: 'FNA', members: 412_000 },
      alliance: null,
      implants: [{ id: 9899, name: 'Ocular Filter - Basic' }],
    },
    wallet: {
      balance: balanceSeries.at(-1)[1],
      series: balanceSeries,
      recent: [
        { t: now - 0.4 * H, amount: 182_400, type: 'market_transaction', description: 'Veldspar sold' },
        { t: now - 2 * H, amount: -24_500, type: 'brokers_fee', description: 'Broker fee' },
        { t: now - 5 * H, amount: 102_000, type: 'agent_mission_reward', description: 'Mission reward' },
      ],
    },
    presence: {
      system: {
        id: sys.id,
        name: sys.name,
        sec: sys.sec,
        regionId: sys.regionId,
        regionName: sys.regionName,
        x: sys.x,
        y: sys.y,
        z: sys.z,
      },
      docked: null,
      ship: { typeId: 32880, typeName: 'Venture', name: "Demo's Venture" },
      online: { online: true, lastLogin: new Date(now - 1.2 * H).toISOString(), logins: 41 },
    },
    skills: {
      queue,
      totalSp: 1_284_550,
      unallocatedSp: 0,
      trainedSkills: 61,
      attributes: {
        intelligence: 20,
        memory: 20,
        perception: 20,
        willpower: 20,
        charisma: 19,
        bonusRemaps: 1,
      },
    },
    industry: {
      jobs: [
        {
          id: 1,
          activity: 'Manufacturing',
          activityId: 1,
          status: 'active',
          product: 'Hobgoblin I',
          blueprint: 'Hobgoblin I Blueprint',
          productTypeId: 2454,
          runs: 10,
          facility: 'Federation Navy Assembly Plant',
          start: now - 1.5 * H,
          end: now + 2.2 * H,
        },
        {
          id: 2,
          activity: 'ME research',
          activityId: 4,
          status: 'active',
          product: 'Venture Blueprint',
          blueprint: 'Venture Blueprint',
          productTypeId: 32881,
          runs: 2,
          facility: 'University of Caille',
          start: now - 6 * H,
          end: now + 0.6 * H,
        },
        {
          id: 3,
          activity: 'Copying',
          activityId: 5,
          status: 'ready',
          product: 'Miner I Blueprint',
          blueprint: 'Miner I Blueprint',
          productTypeId: 484,
          runs: 5,
          facility: 'Federation Navy Assembly Plant',
          start: now - 3 * H,
          end: now - 0.2 * H,
        },
      ],
    },
    orders: {
      orders: [
        {
          id: 11,
          typeId: 1230,
          name: 'Veldspar',
          buy: false,
          price: 13.8,
          volumeTotal: 120_000,
          volumeRemain: 46_200,
          location: 'Dodixie IX - Moon 20',
          regionId: 10000032,
          region: 'Sinq Laison',
          issued: now - 2 * D,
          expires: now + 88 * D,
        },
        {
          id: 12,
          typeId: 34,
          name: 'Tritanium',
          buy: false,
          price: 4.12,
          volumeTotal: 300_000,
          volumeRemain: 300_000,
          location: 'Dodixie IX - Moon 20',
          regionId: 10000032,
          region: 'Sinq Laison',
          issued: now - 4 * H,
          expires: now + 90 * D,
        },
        {
          id: 13,
          typeId: 2454,
          name: 'Hobgoblin I',
          buy: true,
          price: 6_450,
          volumeTotal: 10,
          volumeRemain: 4,
          escrow: 25_800,
          location: 'Luminaire VII - Moon 6',
          regionId: 10000064,
          region: 'Essence',
          issued: now - 6 * D,
          expires: now + 1.2 * D,
        },
        {
          id: 14,
          typeId: 484,
          name: 'Miner I',
          buy: false,
          price: 12_900,
          volumeTotal: 8,
          volumeRemain: 3,
          location: 'Luminaire VII - Moon 6',
          regionId: 10000064,
          region: 'Essence',
          issued: now - 9 * D,
          expires: now + 81 * D,
        },
      ],
      history: {},
    },
    objectives: {
      items: [
        {
          kind: 'freelance',
          id: 'a1',
          title: 'Mine 50,000 m³ of Veldspar for FNA',
          state: 'active',
          progress: { current: 18_400, target: 50_000, ratio: 0.368 },
          mine: { current: 6_100, target: 50_000, ratio: 0.122 },
          ends: now + 3.5 * D,
          reward: 4_500_000,
        },
        {
          kind: 'campaign',
          id: 'c1',
          title: 'Secure the Essence border',
          state: 'active',
          committed: true,
          progress: { current: 0.61, target: 1, ratio: 0.61 },
          ends: now + 6 * D,
        },
      ],
      notes: [],
    },
  };
  // ---- optional modules ----
  {
    const near = universe
      .allSystems()
      .filter((x) => x.regionId === sys.regionId)
      .slice(0, 8);
    const nm = (i) => near[i % near.length] || sys;
    const period = (k) => {
      // k: 1 = today, 7, 30 days; numbers scale roughly with the period
      const f = k === 1 ? 1 : k === 7 ? 5.2 : 19;
      const sources = [
        {
          cat: 'missions',
          label: 'Mission rewards',
          income: 2_150_000 * f,
          expense: 0,
          count: Math.round(6 * f),
        },
        { cat: 'bounties', label: 'Bounties', income: 1_480_000 * f, expense: 0, count: Math.round(3 * f) },
        {
          cat: 'market',
          label: 'Market',
          income: 3_920_000 * f,
          expense: -1_310_000 * f,
          count: Math.round(11 * f),
        },
        {
          cat: 'insurance',
          label: 'Insurance',
          income: k === 1 ? 0 : 1_870_000,
          expense: k === 1 ? 0 : -560_000,
          count: k === 1 ? 0 : 2,
        },
        { cat: 'industry', label: 'Industry', income: 0, expense: -184_000 * f, count: Math.round(2 * f) },
        { cat: 'fees', label: 'Fees', income: 0, expense: -62_000 * f, count: Math.round(f) },
      ].filter((x) => x.count);
      const income = sources.reduce((t, x) => t + x.income, 0);
      const expense = sources.reduce((t, x) => t + x.expense, 0);
      return {
        income,
        expense,
        sources: sources.sort((a, b) => b.income + b.expense - (a.income + a.expense)),
        agents: [
          { id: 3017001, name: 'Aurel Valcour', isk: 1_240_000 * f, count: Math.round(3 * f) },
          { id: 3017002, name: 'Mirelle Daussin', isk: 690_000 * f, count: Math.round(2 * f) },
          { id: 3017003, name: 'Jorvan Teskel', isk: 220_000 * f, count: Math.max(1, Math.round(f)) },
        ],
        systems: [
          { id: nm(1).id, name: nm(1).name, sec: nm(1).sec, isk: 910_000 * f, count: Math.round(2 * f) },
          { id: nm(2).id, name: nm(2).name, sec: nm(2).sec, isk: 570_000 * f, count: Math.round(f) },
        ],
      };
    };
    feeds.activity = {
      periods: { day: period(1), week: period(7), month: period(30) },
      // some days with more going out (ship losses, skill books), so the line has red pieces too
      daily: Array.from({ length: 30 }, (_, i) => ({
        income: (1.2 + r() * 4.5) * 1e6 * (i > 22 ? 1.4 : 1),
        expense: -(0.2 + r() * 1.3 + (i % 5 === 3 ? 5 : 0)) * 1e6,
      })),
      hourly: Array.from({ length: 24 }, (_, hr) => ({
        income: (hr % 3 ? 0.1 + r() * 0.6 : 0) * 1e6,
        expense: -(hr % 4 === 1 ? 0.5 + r() : r() * 0.1) * 1e6,
      })),
      today: Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`),
      entries: 214,
      oldest: now - 30 * D,
      lp: [
        { id: 1000120, name: 'Federation Navy', points: 18_450 },
        { id: 1000107, name: 'Federal Navy Academy', points: 2_310 },
      ],
      lpScope: true,
    };
    const ores = [
      [1230, 'Veldspar', 4.1],
      [1228, 'Scordite', 9.8],
      [1224, 'Pyroxeres', 13.2],
      [17470, 'Concentrated Veldspar', 4.6],
    ];
    const mPeriod = (k) => {
      const f = k === 1 ? 1 : k === 7 ? 5.6 : 21;
      const types = ores
        .map(([typeId, name, p], i) => {
          const q = Math.round((38_000 - i * 9000) * f);
          return { typeId, name, quantity: q, value: q * p };
        })
        .filter((t) => t.quantity > 0);
      const value = types.reduce((t, x) => t + x.value, 0);
      return {
        value,
        units: types.reduce((t, x) => t + x.quantity, 0),
        types,
        systems: [
          { id: sys.id, name: sys.name, sec: sys.sec, quantity: 0, value: value * 0.7 },
          { id: nm(3).id, name: nm(3).name, sec: nm(3).sec, quantity: 0, value: value * 0.3 },
        ],
      };
    };
    feeds.mining = {
      periods: { day: mPeriod(1), week: mPeriod(7), month: mPeriod(30) },
      daily: Array.from({ length: 30 }, (_, i) => (i % 6 === 2 ? 0 : (0.9 + r() * 1.6) * 1e6)),
      days: 25,
    };
    feeds.assets = {
      totalValue: 412_380_000,
      itemCount: 1_284,
      shipCount: 6,
      locationCount: 5,
      ships: [
        {
          itemId: 1,
          typeId: 32880,
          typeName: 'Venture',
          name: "Demo's Venture",
          location: `${sys.name} (in space)`,
          value: 1_420_000,
          active: true,
        },
        {
          itemId: 2,
          typeId: 17480,
          typeName: 'Procurer',
          name: 'Rock Muncher',
          location: `${sys.name} VII - Moon 6 - Federation Navy Testing Facilities`,
          value: 38_600_000,
        },
        {
          itemId: 3,
          typeId: 626,
          typeName: 'Vexor',
          name: null,
          location: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
          value: 21_900_000,
        },
        {
          itemId: 4,
          typeId: 16240,
          typeName: 'Catalyst',
          name: 'Salvage Pal',
          location: `${sys.name} VII - Moon 6 - Federation Navy Testing Facilities`,
          value: 3_100_000,
        },
        {
          itemId: 5,
          typeId: 593,
          typeName: 'Tristan',
          name: null,
          location: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
          value: 1_050_000,
        },
        {
          itemId: 6,
          typeId: 657,
          typeName: 'Iteron Mark V',
          name: 'Hauls Everything',
          location: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
          value: 6_800_000,
        },
      ],
      locations: [
        {
          id: 60011866,
          name: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
          value: 214_500_000,
          items: 612,
          ships: 2,
        },
        {
          id: 60011824,
          name: `${sys.name} VII - Moon 6 - Federation Navy Testing Facilities`,
          value: 148_200_000,
          items: 455,
          ships: 2,
        },
        {
          id: 60003760,
          name: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
          value: 41_900_000,
          items: 188,
          ships: 1,
        },
        { id: sys.id, name: `${sys.name} (in space)`, value: 6_200_000, items: 21, ships: 1 },
        { id: 2004, name: 'Asset Safety', value: 1_580_000, items: 8, ships: 0 },
      ],
    };
    feeds.standings = {
      factions: [
        { id: 500004, name: 'Gallente Federation', standing: 3.42 },
        { id: 500001, name: 'Caldari State', standing: -1.18 },
        { id: 500016, name: 'Servant Sisters of EVE', standing: 0.84 },
        { id: 500020, name: 'Serpentis', standing: -2.65 },
      ],
      corporations: [
        { id: 1000120, name: 'Federation Navy', standing: 4.71 },
        { id: 1000107, name: 'Federal Navy Academy', standing: 2.9 },
        { id: 1000111, name: 'Aliastra', standing: 1.35 },
        { id: 1000135, name: 'Serpentis Corporation', standing: -3.4 },
      ],
      agents: [
        { id: 3017001, name: 'Aurel Valcour', standing: 5.2 },
        { id: 3017002, name: 'Mirelle Daussin', standing: 2.1 },
      ],
    };
    const km = (i, loss, shipTypeId, shipName, value, extra = {}) => ({
      id: 128000000 + i,
      hash: `${(0x9f3c21 + i * 7919).toString(16)}e0a4b7c1d2f38a6b5c4d3e2f1a0b9c8d7e6f5a4b3c`,
      t: now - (i * 17 + 3) * H,
      systemId: nm(i).id,
      systemName: nm(i).name,
      sec: nm(i).sec,
      loss,
      shipTypeId,
      shipName,
      value,
      attackers: loss ? 3 + i : 1 + (i % 4),
      finalBlow: !loss && i % 2 === 0,
      solo: !loss && i % 4 === 1,
      victimName: loss ? 'Demo Capsuleer' : ['Kessa Vynn', 'Mordu Hale', 'Ishuk Lannet', 'Ren Okaru'][i % 4],
      victimCorp: loss ? 'Federal Navy Academy' : 'Dark Harbour Logistics',
      myShipName: loss ? null : 'Tristan',
      ...extra,
    });
    const list = [
      km(0, false, 587, 'Rifter', 8_400_000),
      km(1, false, 32880, 'Venture', 1_900_000),
      km(2, true, 626, 'Vexor', 24_300_000),
      km(3, false, 603, 'Merlin', 6_100_000),
      km(4, false, 670, 'Capsule', 12_000),
    ];
    feeds.kills = {
      list,
      month: {
        kills: list.filter((x) => !x.loss).length,
        losses: list.filter((x) => x.loss).length,
        iskKilled: list.filter((x) => !x.loss).reduce((t, x) => t + x.value, 0),
        iskLost: list.filter((x) => x.loss).reduce((t, x) => t + x.value, 0),
      },
    };
  }

  // hazards: a few believable spots, including two close to the demo location
  {
    const all = universe.allSystems().filter((s) => s.regionId < 11000000);
    const dist = (s) => Math.hypot(s.x - sys.x, s.z - sys.z);
    const near = [...all].sort((a, b) => dist(a) - dist(b));
    const systems = {};
    const add = (s, h) => {
      if (s) (systems[s.id] ||= []).push(h);
    };
    add(near[3], {
      type: 'kills',
      label: '7 player kills in the last hour',
      detail: '5 ships · 2 pods',
      level: 0.35,
    });
    add(near[6], {
      type: 'kills',
      label: '3 player kills in the last hour',
      detail: '2 ships · 1 pod',
      level: 0.15,
    });
    const far = near.slice(Math.floor(near.length * 0.3));
    const incursionRegion = far[0]?.regionId;
    far
      .filter((s) => s.regionId === incursionRegion)
      .slice(0, 6)
      .forEach((s, i) =>
        add(s, {
          type: 'incursion',
          label: i === 0 ? 'Incursion staging system' : 'Incursion',
          detail: "Sansha's Nation · established · influence 62%",
          level: 1,
        }),
      );
    far
      .filter((s) => s.sec < 0)
      .slice(0, 4)
      .forEach((s) =>
        add(s, {
          type: 'sov',
          label: 'Sovereignty fight: ihub defense',
          detail: 'defender 40% / attackers 60%',
          level: 1,
        }),
      );
    near
      .filter((s) => s.sec > 0 && s.sec < 0.45)
      .slice(4, 14)
      .forEach((s, i) =>
        add(s, {
          type: 'fw',
          label: `Faction Warfare: ${i % 3 ? 'contested' : 'vulnerable'}`,
          detail: `Gallente Federation holds it · ${40 + i * 5}% contested`,
          level: 0.6,
        }),
      );
    if (near[3])
      add(near[3], {
        type: 'fw',
        label: 'Faction Warfare: contested',
        detail: 'Caldari State holds it · 72% contested',
        level: 0.7,
      });
    add(far[25], {
      type: 'campaign',
      label: 'Military campaign objective',
      detail: 'Secure the Essence border',
      level: 1,
    });
    const counts = {};
    for (const list of Object.values(systems))
      for (const h of list) counts[h.type] = (counts[h.type] || 0) + 1;
    feeds.hazards = { systems, counts, notes: [], killThreshold: 3 };
  }

  {
    const kills = {};
    const jumps = {};
    for (const s of universe.allSystems()) {
      const j = Math.floor(Math.pow(r(), 3) * (s.sec >= 0.5 ? 400 : 120));
      if (j) jumps[s.id] = j;
      if (r() < 0.12) kills[s.id] = [Math.floor(r() * 3), Math.floor(r() * 2), Math.floor(r() * 60)];
    }
    jumps[sys.id] = 312;
    kills[sys.id] = [2, 1, 45];
    const sorted = Object.values(jumps).sort((a, b) => a - b);
    feeds.traffic = {
      kills,
      jumps,
      busyJumps: sorted[Math.floor(sorted.length * 0.9)],
      maxJumps: sorted.at(-1),
    };
  }

  {
    // Sovereignty: empire regions by name (when the real star map is cached), player alliances in null-sec,
    // and a few Faction Warfare systems occupied by the enemy.
    const REGION_FACTION = {
      'The Forge': 500001,
      Lonetrek: 500001,
      'The Citadel': 500001,
      'Black Rise': 500001,
      Essence: 500004,
      'Verge Vendor': 500004,
      'Sinq Laison': 500004,
      Everyshore: 500004,
      Placid: 500004,
      Solitude: 500004,
      Heimatar: 500002,
      Metropolis: 500002,
      'Molden Heath': 500002,
      Domain: 500003,
      Kador: 500003,
      'Tash-Murkon': 500003,
      Devoid: 500003,
      'The Bleak Lands': 500003,
      Aridia: 500003,
      Genesis: 500003,
      'Kor-Azor': 500003,
      Khanid: 500008,
      Derelik: 500007,
      'Great Wildlands': 500015,
      Pochven: 500026,
      Venal: 500010,
      Stain: 500019,
      Curse: 500011,
      Syndicate: 500009,
      'Outer Ring': 500014,
    };
    const empires = [500001, 500002, 500003, 500004];
    const alliances = [99000101, 99000102, 99000103, 99000104, 99000105, 99000106];
    const owners = {};
    const fw = {};
    const regionIndex = new Map();
    for (const s of universe.allSystems()) {
      if (!universe.isKSpace(s.regionId)) continue;
      if (!regionIndex.has(s.regionId)) regionIndex.set(s.regionId, regionIndex.size);
      const ri = regionIndex.get(s.regionId);
      const named = REGION_FACTION[s.regionName];
      if (named) owners[s.id] = named;
      else if (s.sec >= 0) owners[s.id] = empires[ri % 4];
      else if (ri % 5 !== 0) owners[s.id] = alliances[(ri + (s.id % 2)) % alliances.length]; // some null-sec stays unclaimed
      if (s.sec > 0 && s.sec < 0.45 && [500001, 500004].includes(owners[s.id]) && r() < 0.25)
        fw[s.id] = [owners[s.id], owners[s.id] === 500001 ? 500004 : 500001];
    }
    const names = {
      500001: 'Caldari State',
      500002: 'Minmatar Republic',
      500003: 'Amarr Empire',
      500004: 'Gallente Federation',
      500007: 'Ammatar Mandate',
      500008: 'Khanid Kingdom',
      500009: 'The Syndicate',
      500010: 'Guristas Pirates',
      500011: 'Angel Cartel',
      500014: 'ORE',
      500015: 'Thukker Tribe',
      500019: "Sansha's Nation",
      500026: 'Triglavian Collective',
      99000101: 'Northern Demo Coalition',
      99000102: 'Fountain Fleet',
      99000103: 'Void Lancers',
      99000104: 'Pale Horizon',
      99000105: 'Brave Sparrows',
      99000106: 'Iron Tribunal',
    };
    feeds.sovereignty = { owners, fw, names };
  }

  feeds.mail = { unread: 2, labels: [{ name: 'Inbox', unread: 2 }] };
  // notifications: two old ones (seen on first run), then a new one every 20 s (twice)
  feeds.notifications = {
    items: [
      { id: 2, type: 'CorpAllBillMsg', label: 'Corp All Bill', t: now - 3 * H },
      { id: 1, type: 'SkillPointsAppliedMsg', label: 'Skill Points Applied', t: now - 26 * H },
    ],
    total: 2,
    ignored: 0,
  };
  const extraNotifications = [
    { id: 3, type: 'IndustryJobDelivered', label: 'Industry Job Delivered' },
    { id: 4, type: 'StructureUnderAttack', label: 'Structure Under Attack' },
  ];

  feeds.clones = {
    home: {
      id: 60011866,
      structure: false,
      name: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
      systemId: 30002659,
      systemName: 'Dodixie',
      sec: 0.87,
    },
    jumpClones: 0,
    lastCloneJump: null,
    lastStationChange: now - 12 * D,
  };

  feeds.warfare = {
    myCorp: { corporationId: 1000107, allianceId: null, npc: true },
    wars: [
      {
        id: 801,
        aggressor: { id: 98000001, isk: 4.2e9, ships: 61 },
        defender: { id: 99000001, isk: 1.1e9, ships: 17 },
        started: now - 3 * D,
        mutual: false,
        allies: 2,
        mine: false,
      },
      {
        id: 802,
        aggressor: { id: 99000002, isk: 6.8e8, ships: 9 },
        defender: { id: 98000002, isk: 9.4e8, ships: 12 },
        started: now - 9 * D,
        mutual: true,
        allies: 0,
        mine: false,
      },
      {
        id: 803,
        aggressor: { id: 98000003, isk: 0, ships: 0 },
        defender: { id: 98000004, isk: 2.5e7, ships: 1 },
        started: now - 20 * D,
        finished: now - 2 * D,
        mutual: false,
        allies: 0,
        mine: false,
      },
    ],
    fw: {
      factions: [
        { id: 500004, pilots: 14211, systems: 61, killsYesterday: 1840, killsWeek: 12011, vpWeek: 4.1e6 },
        { id: 500001, pilots: 15983, systems: 53, killsYesterday: 2102, killsWeek: 13560, vpWeek: 4.6e6 },
        { id: 500003, pilots: 11840, systems: 48, killsYesterday: 1311, killsWeek: 9002, vpWeek: 3.2e6 },
        { id: 500002, pilots: 12655, systems: 44, killsYesterday: 1508, killsWeek: 10244, vpWeek: 3.4e6 },
      ],
      wars: [
        [500001, 500004],
        [500004, 500001],
        [500003, 500002],
        [500002, 500003],
      ],
    },
    me: { enlisted: false },
    leaderboards: (() => {
      const mk = (ids) =>
        Object.fromEntries(
          ['kills', 'victory_points'].map((m) => [
            m,
            Object.fromEntries(
              ['yesterday', 'last_week', 'active_total'].map((p, pi) => [
                p,
                ids.map((id, i) => ({
                  id,
                  amount: Math.round(((m === 'kills' ? 900 : 260000) * (pi * 4 + 1)) / (i + 1.2)),
                })),
              ]),
            ),
          ]),
        );
      return {
        factions: mk([500001, 500004, 500002, 500003]),
        corporations: mk([98000001, 98000002, 98000003, 98000004, 98000005]),
        characters: mk([90000001, 90000002, 90000003, 90000004, 90000005, 90000006]),
      };
    })(),
    campaigns: [
      {
        id: 'c1a2b3c4',
        title: 'Secure the Essence border',
        state: 'active',
        progress: { current: 0.61, target: 1, ratio: 0.61 },
        finish: now + 6 * D,
      },
    ],
    incursions: [
      {
        constellationId: 20000400,
        stagingId: 30002700,
        faction: "Sansha's Nation",
        state: 'established',
        influence: 0.62,
        boss: true,
        systems: 6,
      },
    ],
    names: {
      98000001: 'Hauler Hunters Inc.',
      99000001: 'Quiet Miners Collective',
      99000002: 'Blackwater Syndicate',
      98000002: 'Ore Barons',
      98000003: 'Red Sun Logistics',
      98000004: 'Tiny Corp',
      98000005: 'Frontier Wardens',
      500001: 'Caldari State',
      500002: 'Minmatar Republic',
      500003: 'Amarr Empire',
      500004: 'Gallente Federation',
      90000001: 'Arvel Toor',
      90000002: 'Kessa Vynn',
      90000003: 'Mordu Hale',
      90000004: 'Ishuk Lannet',
      90000005: 'Ren Okaru',
      90000006: 'Teodor Blanc',
      20000400: 'Kimotoro-B',
      30002700: 'Aunenen',
    },
    notes: [],
  };

  for (const o of feeds.orders.orders) {
    const series = [];
    let p = o.price;
    for (let i = 30; i > 0; i--) {
      p *= 1 + (r() - 0.5) * 0.06;
      series.push([now - i * D, p, Math.round(r() * 1e5)]);
    }
    feeds.orders.history[`${o.regionId}:${o.typeId}`] = series;
  }

  function emit(name) {
    publish(name, { data: feeds[name], error: null, updatedAt: Date.now(), nextAt: Date.now() + 60_000 });
  }

  const chat = { local: [], corp: [] };
  const seedChat = (id, n) => {
    for (let i = n; i > 0; i--) {
      chat[id].push({
        t: now - i * 47_000,
        from: pilots[Math.floor(r() * pilots.length)],
        text: lines[Math.floor(r() * lines.length)],
        system: false,
        self: false,
      });
    }
  };
  chat.local.push({
    t: now - 30 * 60_000,
    from: 'EVE System',
    text: `Channel changed to Local : ${sys.name}`,
    system: true,
    self: false,
  });
  seedChat('local', 14);
  seedChat('corp', 9);
  chat.corp.push({
    t: now - 60_000,
    from: 'Demo Capsuleer',
    text: 'heading to the belt, anyone want to join?',
    system: false,
    self: true,
  });
  // lines with linked items, written the way the client logs them: plain names with two spaces around
  const linked = (from, raw, self = false) => ({
    t: now - 20_000,
    from,
    ...parseMessage(raw),
    system: false,
    self,
  });
  chat.local.push(linked('Aura Vex', 'WTS  Damage Control II  and  Tritanium  , convo me'));
  chat.corp.push(linked('Mira Solenne', 'fit a  Damage Control II  on your  Rifter  and meet in  Jita'));

  function start(publishChat) {
    for (const name of Object.keys(feeds)) emit(name);
    setInterval(() => {
      feeds.wallet.balance += Math.round((r() - 0.3) * 40_000);
      feeds.wallet.series.push([Date.now(), feeds.wallet.balance]);
      if (feeds.wallet.series.length > 60) feeds.wallet.series.shift();
      emit('wallet');
    }, 9000).unref?.(); // unref: Node only (the demo website runs this in the browser)
    // every 20 s one more unread notification arrives (until two have arrived)
    const notifTimer = setInterval(() => {
      const next = extraNotifications.shift();
      if (!next) {
        clearInterval(notifTimer);
        return;
      }
      feeds.notifications.items.unshift({ ...next, t: Date.now() });
      feeds.notifications.total += 1;
      emit('notifications');
    }, 20000);
    notifTimer.unref?.();
    const mailCycle = [3, 0, 2];
    let mi = 0;
    setInterval(() => {
      feeds.mail = {
        unread: mailCycle[mi],
        labels: mailCycle[mi] ? [{ name: 'Inbox', unread: mailCycle[mi] }] : [],
      };
      mi = (mi + 1) % mailCycle.length;
      emit('mail');
    }, 12000).unref?.();
    setInterval(() => {
      const channel = r() < 0.65 ? 'local' : 'corp';
      const msg = {
        t: Date.now(),
        from: pilots[Math.floor(r() * pilots.length)],
        text: lines[Math.floor(r() * lines.length)],
        system: false,
        self: false,
      };
      chat[channel].push(msg);
      publishChat(channel, [msg]);
    }, 6500).unref?.();
  }

  return { start, chat, feeds };
}

// Item names the demo can recognise in chat when the real SDE names haven't been downloaded.
export const DEMO_ITEM_NAMES = [
  [2048, 'Damage Control II'],
  [34, 'Tritanium'],
  [587, 'Rifter'],
];

// Canned answers for the item window in demo mode (no ESI calls).
export function demoShowInfo(universe) {
  const types = {
    2048: {
      name: 'Damage Control II',
      group: 'Damage Control',
      category: 'Module',
      categoryId: 7,
      image: 'icon',
      techLevel: 2,
      metaLevel: 5,
      volume: 5,
      price: { average: 412_000, adjusted: 398_500 },
      description:
        'Utilizes a combination of containment field emitters and redundancy systems to prevent critical system damage.\n\nGrants a bonus to resistances on shield, armor and hull. Only one damage control can be fitted at a time.',
    },
    34: {
      name: 'Tritanium',
      group: 'Mineral',
      category: 'Material',
      categoryId: 4,
      image: 'icon',
      volume: 0.01,
      price: { average: 4.12, adjusted: 3.98 },
      description:
        'The main building block in space structures. A very hard, yet bendable metal. Cannot be used in human habitats due to its instability at atmospheric temperatures.',
    },
    587: {
      name: 'Rifter',
      group: 'Frigate',
      category: 'Ship',
      categoryId: 6,
      image: 'render',
      techLevel: 1,
      metaLevel: 0,
      volume: 2500,
      mass: 1_067_000,
      price: { average: 512_000, adjusted: 498_000 },
      description:
        'The Rifter is a very powerful combat frigate and can easily tackle the best frigates out there. It has gone through many radical design phases since its inauguration during the Minmatar Rebellion.',
    },
  };
  return {
    async lookup(typeId, itemId) {
      typeId = Number(typeId);
      itemId = itemId ? Number(itemId) : null;
      await new Promise((r) => setTimeout(r, 250)); // feel like a network round trip
      if (!itemId && types[typeId]) return { kind: 'type', typeId, published: true, ...types[typeId] };
      if (typeId === 5) {
        const s = universe.system(itemId);
        if (s)
          return {
            kind: 'system',
            id: itemId,
            name: s.name,
            securityStatus: s.sec,
            region: s.regionName || null,
            onMap: true,
          };
      }
      if (typeId === 1377) {
        return {
          kind: 'character',
          id: itemId,
          name: 'Demo Capsuleer',
          corporation: { id: 1000044, name: 'School of Applied Knowledge' },
          alliance: null,
          birthday: '2026-10-01T12:00:00Z',
          securityStatus: 0.42,
        };
      }
      const e = new Error('Demo mode only knows a few items');
      e.status = 404;
      throw e;
    },
  };
}
