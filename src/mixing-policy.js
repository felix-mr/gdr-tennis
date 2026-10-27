import { poolFeasible } from './schedule-pools.js';

export function mixingCounts(matchMap, leagues, ids = Object.keys(leagues)) {
  const counts = Object.fromEntries(ids.map(id => [id, 0]));
  for (const match of Object.values(matchMap)) {
    const active = [...match.teamA, ...match.teamB];
    if (new Set(active.map(id => leagues[id])).size > 1) for (const id of active) counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}

export function mixingLimits(ids, quotas, leagues, pairs, relax = false) {
  const sizes = [0, 1].map(group => ids.filter(id => leagues[id] === group).length);
  const scarce = sizes.every(Boolean) && Math.min(...sizes) < 4;
  const fixed = new Set(pairs.filter(([a, b]) => leagues[a] !== leagues[b]).flat());
  return Object.fromEntries(ids.map(id => [id, scarce || (relax && pairs.length) || fixed.has(id) ? quotas[id] : 1]));
}

// Necessary group-level layout check. Individual quotas and fixed pairs remain
// validated by the scheduler. A mixed match uses each participant's one allowance.
export function minimumMixedMatches(ids, quotas, leagues, rounds) {
  const sizes = [0, 1].map(group => ids.filter(id => leagues[id] === group).length);
  const total = [0, 1].map(group => ids.filter(id => leagues[id] === group).reduce((sum, id) => sum + quotas[id], 0));
  if (total[0] + total[1] !== rounds * 8) return Infinity;
  const memo = new Map();
  const fits = (types, remaining) => {
    if (!remaining) return types.every(n => !n);
    const key = remaining + ':' + types.join(','); if (memo.has(key)) return memo.get(key);
    for (let a = 0; a <= 4; a++) if (types[a]) for (let b = a; b <= 4; b++) if (types[b] >= (a === b ? 2 : 1) && a + b <= sizes[0] && 8 - a - b <= sizes[1]) {
      const next = [...types]; next[a]--; next[b]--;
      if (fits(next, remaining - 1)) { memo.set(key, true); return true; }
    }
    memo.set(key, false); return false;
  };
  for (let mixed = 0; mixed <= Math.floor(ids.length / 4); mixed++) {
    for (let one = 0; one <= mixed; one++) for (let two = 0; two <= mixed - one; two++) {
      const three = mixed - one - two, upper = one + 2 * two + 3 * three, lower = mixed * 4 - upper;
      if (upper > sizes[0] || lower > sizes[1]) continue;
      const pureUpper = (total[0] - upper) / 4, pureLower = (total[1] - lower) / 4;
      if (!Number.isInteger(pureUpper) || !Number.isInteger(pureLower) || pureUpper < 0 || pureLower < 0) continue;
      if (fits([pureLower, one, two, three, pureUpper], rounds)) return mixed;
    }
  }
  return Infinity;
}

export function allocateMixingQuotas(ids, rounds, pairs, leagues, random = Math.random) {
  if (!ids.every(id => [0, 1].includes(leagues[id])) || [0, 1].some(group => ids.filter(id => leagues[id] === group).length < 4) || pairs.some(([a, b]) => leagues[a] !== leagues[b])) return null;
  const paired = new Set(pairs.flat()), units = [...pairs, ...ids.filter(id => !paired.has(id)).map(id => [id])];
  const base = Math.floor(8 * rounds / ids.length), extras = 8 * rounds - base * ids.length;
  let states = new Map([['0:0:0:0', { count: 0, upper: 0, pairedUpper: 0, pairedLower: 0, ids: [], cost: 0 }]]);
  for (const unit of units) {
    const next = new Map(), tie = random();
    for (const state of states.values()) for (const extra of [0, 1]) {
      const count = state.count + extra * unit.length, upper = state.upper + extra * unit.filter(id => leagues[id] === 0).length;
      if (count > extras) continue;
      const pairedUpper = state.pairedUpper + Number(extra && unit.length === 2 && leagues[unit[0]] === 0), pairedLower = state.pairedLower + Number(extra && unit.length === 2 && leagues[unit[0]] === 1);
      const cost = state.cost + extra * tie, key = `${count}:${upper}:${pairedUpper}:${pairedLower}`;
      if (!next.has(key) || cost < next.get(key).cost) next.set(key, { count, upper, pairedUpper, pairedLower, ids: extra ? [...state.ids, ...unit] : state.ids, cost });
    }
    states = next;
  }
  const choices = [...states.values()].filter(state => state.count === extras).map(state => {
    const additional = new Set(state.ids), quotas = Object.fromEntries(ids.map(id => [id, base + Number(additional.has(id))]));
    return { quotas, minimum: minimumMixedMatches(ids, quotas, leagues, rounds), cost: state.cost };
  }).filter(choice => Number.isFinite(choice.minimum) && poolFeasible(units, choice.quotas, rounds, new Map(), 8)).sort((a, b) => a.minimum - b.minimum || a.cost - b.cost);
  return choices[0]?.quotas || null;
}
