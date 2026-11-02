// SPDX-License-Identifier: GPL-3.0-or-later
// Wallet journal sources (Activity & income) and killmail summaries (Kills & losses).

// ---------- wallet journal sources (Activity & income) ----------
// ref_type -> source. Anything not listed counts as "other".
const REF_GROUPS = [
  ['missions', /^agent_mission/],
  ['bounties', /^(bounty_prize|bounty_prizes|ess_escrow_transfer)$/],
  ['market', /^(market_transaction|market_escrow|market_provider_tax|brokers_fee|transaction_tax)$/],
  ['insurance', /^insurance$/],
  ['contracts', /^contract_/],
  ['industry', /^(industry_job_tax|manufacturing|reprocessing_tax|copying|researching_|reaction)/],
  ['planetary', /^planetary_/],
  ['lp', /^lp_store$/],
  [
    'rewards',
    /^(corporate_reward_payout|milestone_reward_payment|daily_goal_payouts|freelance_jobs|project_)/,
  ],
  [
    'transfers',
    /^(player_donation|player_trading|corporation_account_withdrawal|corporation_dividend_payment|union_payment)$/,
  ],
  [
    'fees',
    /^(jump_clone_activation_fee|jump_clone_installation_fee|clone_transfer|docking_fee|office_rental_fee|structure_gate_jump|skill_purchase|asset_safety_recovery_tax)$/,
  ],
];
export const REF_LABELS = {
  missions: 'Mission rewards',
  bounties: 'Bounties',
  market: 'Market',
  insurance: 'Insurance',
  contracts: 'Contracts',
  industry: 'Industry',
  planetary: 'Planetary',
  lp: 'LP store',
  rewards: 'Rewards',
  transfers: 'Transfers',
  fees: 'Fees',
  other: 'Other',
};
export function categoryOfRef(refType) {
  for (const [cat, re] of REF_GROUPS) if (re.test(String(refType || ''))) return cat;
  return 'other';
}
export const startOfEveDay = (t) => Date.parse(`${new Date(t).toISOString().slice(0, 10)}T00:00:00Z`); // EVE time is UTC

// One killmail -> what the Kills & losses module shows. Value: ship + destroyed and dropped items,
// at average market prices (an estimate, like zKillboard's but without its corrections).
export function summarizeKillmail(km, me, price = new Map(), hash = null) {
  const v = km.victim || {};
  const p = (id) => price.get(id) || 0;
  const itemValue = (items = []) =>
    items.reduce(
      (s, it) =>
        s +
        p(it.item_type_id) * ((it.quantity_destroyed || 0) + (it.quantity_dropped || 0)) +
        itemValue(it.items),
      0,
    );
  const attackers = km.attackers || [];
  const mine = attackers.find((a) => a.character_id === me);
  const final = attackers.find((a) => a.final_blow);
  return {
    id: km.killmail_id,
    hash: hash || null,
    t: Date.parse(km.killmail_time),
    systemId: km.solar_system_id,
    loss: v.character_id === me,
    shipTypeId: v.ship_type_id,
    victimId: v.character_id || null,
    victimCorpId: v.corporation_id || null,
    value: p(v.ship_type_id) + itemValue(v.items),
    attackers: attackers.length,
    finalBlow: Boolean(mine?.final_blow),
    myShipTypeId: mine?.ship_type_id || null,
    finalBlowShipTypeId: final?.ship_type_id || null,
    solo: attackers.length === 1,
  };
}
