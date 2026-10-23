import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule, allocateForWindow } from '../src/scheduler.js';
import { STRENGTH_STEP } from '../src/pairing-policy.js';
import { validateSession } from '../src/model.js';

const seeded = value => () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
function allocate(ids, rounds, pairs, seed) {
  const previous = Math.random;
  try { Math.random = seeded(seed); return allocateForWindow(ids, rounds, pairs); }
  finally { Math.random = previous; }
}
function exposure(matchMap, pair) {
  const counts = {};
  for (const match of Object.values(matchMap)) {
    const side = ['teamA', 'teamB'].find(side => pair.every(id => match[side].includes(id)));
    if (side) for (const id of match[side === 'teamA' ? 'teamB' : 'teamA']) counts[id] = (counts[id] || 0) + 1;
  }
  return counts;
}
function verify(result, ids, quotas, lockedPairs, guests = {}) {
  const rounds = Math.max(...Object.values(result.matchMap).map(match => match.round));
  const members = ids.filter(id => !Object.hasOwn(guests, id));
  validateSession({ date: '2026-10-25', startTime: '00:00', endTime: `${String(Math.floor(rounds / 2)).padStart(2, '0')}:${rounds % 2 ? '30' : '00'}`, roundMinutes: 30, participantIds: ids, fixedPlayerIds: members, guests, lockedPairs, matchMap: result.matchMap }, members);
  for (const id of ids) assert.equal(Object.values(result.matchMap).filter(match => [...match.teamA, ...match.teamB].includes(id)).length, quotas[id]);
  for (const pair of lockedPairs) for (const match of Object.values(result.matchMap)) if ([...match.teamA, ...match.teamB].some(id => pair.includes(id))) assert.ok([match.teamA, match.teamB].some(team => pair.every(id => team.includes(id))));
}

test('a fixed pair meets different individuals even when the opposing partners change', () => {
  const ids = Array.from({ length: 14 }, (_, i) => `p${i}`);
  const values = [0.912, 0.898, 0.736, 0.746, 0.580, 0.579, 0.417, 0.428, 0.250, 0.260, 0.261, 0.260, 0.112, 0.090];
  const strengths = Object.fromEntries(ids.map((id, i) => [id, values[i]]));
  const pair = ['p2', 'p9'], lockedPairs = [pair];
  const quotas = Object.fromEntries(ids.map((id, index) => [id, [0, 1, 2, 3, 8, 9].includes(index) ? 4 : 3]));
  for (const seed of [7, 73, 2026, 7137]) {
    const result = generateSchedule(ids, quotas, { strengths, lockedPairs, random: seeded(seed) });
    verify(result, ids, quotas, lockedPairs);
    assert.equal(result.consecutiveRests, 0);
    assert.equal(result.partnerRepeats, 0);
    assert.ok(result.balance.maxGap / STRENGTH_STEP <= 2.25 + 1e-9);
    assert.ok(Object.values(exposure(result.matchMap, pair)).every(count => count === 1), `seed ${seed}: ${JSON.stringify(exposure(result.matchMap, pair))}`);
  }
});

// Exact feasibility oracle for quotas and pair units. It ignores all soft
// preferences, groups interchangeable units, and searches every round layout.
function fixedFeasible(ids, quotas, pairs, rounds) {
  const paired = new Set(pairs.flat());
  const units = [...pairs.map(pair => [2, quotas[pair[0]]]), ...ids.filter(id => !paired.has(id)).map(id => [1, quotas[id]])];
  const capacity = ids.length >= 8 ? 8 : 4, memo = new Map();
  function search(units, remainingRounds) {
    units = units.filter(([, n]) => n).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (!units.length) return remainingRounds === 0;
    if (!remainingRounds || units.some(([, n]) => n > remainingRounds)) return false;
    const slots = units.reduce((sum, [size, n]) => sum + size * n, 0);
    if (slots < remainingRounds * 4 || slots > remainingRounds * capacity) return false;
    const key = `${remainingRounds}:${JSON.stringify(units)}`;
    if (memo.has(key)) return memo.get(key);
    const groups = [];
    for (const [size, n] of units) {
      const last = groups.at(-1);
      if (last && last.size === size && last.n === n) last.count++;
      else groups.push({ size, n, count: 1 });
    }
    function choose(index, selected, next) {
      if (selected > capacity) return false;
      if (index === groups.length) return (selected === 4 || selected === 8) && search(next, remainingRounds - 1);
      const { size, n, count } = groups[index];
      for (let take = n === remainingRounds ? count : 0; take <= count; take++) {
        if (choose(index + 1, selected + take * size, [...next, ...Array.from({ length: take }, () => [size, n - 1]), ...Array.from({ length: count - take }, () => [size, n])])) return true;
      }
      return false;
    }
    const result = choose(0, 0, []); memo.set(key, result); return result;
  }
  return search(units, rounds);
}

test('edge rosters preserve every quota; fixed-pair relaxation happens only when exact pair scheduling is impossible', () => {
  for (const count of [4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 16, 17, 18, 20, 22, 24, 32]) for (const rounds of [4, 6, ...(count === 32 ? [8] : [])]) for (const allFixed of [false, true]) {
    const ids = Array.from({ length: count }, (_, i) => `p${i}`);
    const lockedPairs = allFixed ? Array.from({ length: Math.floor(count / 2) }, (_, i) => ids.slice(i * 2, i * 2 + 2)) : [ids.slice(0, 2)];
    if (rounds * (count >= 8 ? 8 : 4) < count * 2) { assert.throws(() => allocateForWindow(ids, rounds, lockedPairs), /최소 2경기/); continue; }
    const quotas = allocate(ids, rounds, lockedPairs, count * 101 + rounds + Number(allFixed));
    const possible = fixedFeasible(ids, quotas, lockedPairs, rounds);
    const result = generateSchedule(ids, quotas, { lockedPairs, random: seeded(73), attempts: 60 });
    verify(result, ids, quotas, possible ? lockedPairs : []);
    assert.equal(Math.max(...Object.values(result.matchMap).map(match => match.round)), rounds);
  }
});

test('guests, opposite timing preferences and long windows preserve fixed pairs and exact quotas', () => {
  for (const [count, guestCount] of [[6, 2], [10, 2], [16, 2], [14, 8]]) {
    const guests = Object.fromEntries(Array.from({ length: guestCount }, (_, i) => [`guest${String(i + 1).padStart(3, '0')}`, { name: `손님${i + 1}` }]));
    const ids = [...Array.from({ length: count }, (_, i) => `p${i}`), ...Object.keys(guests)];
    const lockedPairs = [ids.slice(0, 2)];
    const rounds = count === 6 ? 47 : 6;
    const quotas = allocate(ids, rounds, lockedPairs, count * 101);
    const timingPreferences = { p0: 'early', p1: 'late', guest001: 'late', guest002: 'early' };
    const strengths = Object.fromEntries(ids.map((id, index) => [id, index % 2 ? 0.9 : 0.1]));
    const result = generateSchedule(ids, quotas, { lockedPairs, timingPreferences, strengths, random: seeded(2026), attempts: 40 });
    verify(result, ids, quotas, lockedPairs, guests);
  }
});

test('fixed teams do not trade large matchup gaps for unique opponents', () => {
  const ids = Array.from({ length: 8 }, (_, i) => `p${i}`), lockedPairs = [ids.slice(0, 2)], quotas = Object.fromEntries(ids.map(id => [id, 3]));
  const strengths = Object.fromEntries(ids.map((id, index) => [id, index < 4 ? 0.9 : 0.1]));
  const result = generateSchedule(ids, quotas, { lockedPairs, strengths, random: seeded(73) });
  verify(result, ids, quotas, lockedPairs);
  assert.ok(result.balance.maxGap / STRENGTH_STEP <= 2.25 + 1e-9);
  assert.ok(Math.max(...Object.values(exposure(result.matchMap, lockedPairs[0]))) > 1);
});

test('four fixed teams can rotate through one another without repeating opposing individuals', () => {
  const ids = Array.from({ length: 8 }, (_, i) => `p${i}`), lockedPairs = Array.from({ length: 4 }, (_, i) => ids.slice(i * 2, i * 2 + 2));
  const quotas = Object.fromEntries(ids.map(id => [id, 3]));
  const result = generateSchedule(ids, quotas, { lockedPairs, random: seeded(73) });
  verify(result, ids, quotas, lockedPairs);
  for (const pair of lockedPairs) assert.ok(Object.values(exposure(result.matchMap, pair)).every(count => count === 1));
});

test('unavoidable opponent repetition with only four people does not split fixed pairs or fail', () => {
  const ids = ['a', 'b', 'c', 'd'], quotas = Object.fromEntries(ids.map(id => [id, 6]));
  for (const lockedPairs of [[['a', 'b']], [['a', 'b'], ['c', 'd']]]) {
    const result = generateSchedule(ids, quotas, { lockedPairs, random: seeded(2026) });
    verify(result, ids, quotas, lockedPairs);
    assert.deepEqual(exposure(result.matchMap, ['a', 'b']), { c: 6, d: 6 });
  }
});
