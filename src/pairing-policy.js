import { validDate } from './model.js';
import { halfYear, withinPeriod } from './periods.js';

export const STRENGTH_STEP = 0.8 / 6;
export const TEAM_GAP_ALLOWANCE = 2 * STRENGTH_STEP;
// Stable roster IDs: 허근화, 장재혁. One shared group for daily partner rotation.
export const ROTATING_PLAYERS = ['gdr011', 'gdr010'];
export const pairKey = (a, b) => [a, b].sort().join('|');

// Equal team sums can still repeatedly pair the strongest with the weakest.
// Prefer nearby individuals as another option, without fixing membership bands
// or imposing a quota of similar-level games. Opposing team gaps stay separate.
export function matchSpreadCost(four, strength) {
  const values = four.map(strength);
  const spread = (Math.max(...values) - Math.min(...values)) / STRENGTH_STEP;
  return 160 * spread ** 2 / (spread ** 2 + 4);
}

export function recentPairingHistory(schedules, date, ids) {
  const partners = {}, opponents = {}, expected = {}, allowed = new Set(ids);
  if (!validDate(date)) return { partners, opponents };
  const dated = new Map();
  for (const session of schedules) if (validDate(session?.date) && session.date < date && withinPeriod(halfYear(date), session.date)) dated.set(session.date, session);
  const recent = [...dated.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
  for (const [index, session] of recent.entries()) {
    if (!Array.isArray(session.participantIds) || !Array.isArray(session.fixedPlayerIds)) continue;
    const members = session.fixedPlayerIds.filter(id => allowed.has(id) && session.participantIds.includes(id));
    const fixed = new Set(members), games = Object.fromEntries(members.map(id => [id, 0]));
    const weight = 0.8 ** index;
    const matches = Object.values(session.matchMap || {}).filter(match => Array.isArray(match.teamA) && Array.isArray(match.teamB) && match.teamA.length === 2 && match.teamB.length === 2 && new Set([...match.teamA, ...match.teamB]).size === 4 && [...match.teamA, ...match.teamB].every(id => session.participantIds.includes(id)));
    for (const match of matches) {
      for (const team of [match.teamA, match.teamB]) {
        for (const id of team) if (fixed.has(id)) games[id]++;
        if (team.every(id => fixed.has(id))) { const key = pairKey(...team); partners[key] = (partners[key] || 0) + weight; }
      }
      for (const a of match.teamA) for (const b of match.teamB) if (fixed.has(a) && fixed.has(b)) { const key = pairKey(a, b); opponents[key] = (opponents[key] || 0) + weight; }
    }
    for (let a = 0; a < members.length; a++) for (let b = a + 1; b < members.length; b++) {
      const key = pairKey(members[a], members[b]);
      expected[key] = (expected[key] || 0) + weight * (games[members[a]] + games[members[b]]) / (2 * Math.max(1, session.participantIds.length - 1));
    }
  }
  const loads = (counts, multiplier) => Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, ((counts[key] || 0) - multiplier * value) / (1 + multiplier * value)]));
  return { partners: loads(partners, 1), opponents: loads(opponents, 2) };
}

export function nearbyPairing(active, lockedPairs, strength, random) {
  const fixed = lockedPairs.filter(pair => active.includes(pair[0]));
  const used = new Set(fixed.flat());
  const units = [...fixed, ...active.filter(id => !used.has(id)).map(id => [id])].map(unit => ({ unit, value: unit.reduce((sum, id) => sum + strength(id), 0) / unit.length, tie: random() })).sort((a, b) => a.value - b.value || a.tie - b.tie).map(item => item.unit);
  const output = [];
  while (units.length) {
    const quartet = [];
    while (quartet.flat().length < 4) {
      const index = units.findIndex(unit => unit.length <= 4 - quartet.flat().length);
      if (index < 0) return null;
      quartet.push(units.splice(index, 1)[0]);
    }
    const singles = quartet.filter(unit => unit.length === 1).flat().map(id => ({ id, tie: random() })).sort((a, b) => a.tie - b.tie).map(item => item.id);
    const teams = quartet.filter(unit => unit.length === 2);
    for (let i = 0; i < singles.length; i += 2) teams.push(singles.slice(i, i + 2));
    if (random() < 0.5) teams.reverse();
    output.push(...teams.flat());
  }
  return output;
}
