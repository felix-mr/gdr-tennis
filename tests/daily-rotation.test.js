import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule } from '../src/scheduler.js';
import { initialStrengths } from '../src/ratings.js';
import players from '../data/players.json' with { type: 'json' };
import baseline from '../data/strength-baseline.json' with { type: 'json' };

const special = ['gdr011', 'gdr010'];
function seeded(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function verify(result, ids, quotas) {
  const partners = Object.fromEntries(special.map(id => [id, []]));
  let opposed = 0;
  const played = Object.fromEntries(ids.map(id => [id, 0]));
  const active = {};
  for (const match of Object.values(result.matchMap)) {
    active[match.round] ??= new Set();
    for (const team of [match.teamA, match.teamB]) for (const id of team) {
      assert.ok(!active[match.round].has(id));
      active[match.round].add(id);
      played[id]++;
      if (partners[id]) partners[id].push(team.find(other => other !== id));
    }
    if (match.teamA.includes(special[0]) && match.teamB.includes(special[1]) || match.teamA.includes(special[1]) && match.teamB.includes(special[0])) opposed++;
  }
  for (const list of Object.values(partners)) assert.equal(new Set(list).size, list.length);
  assert.deepEqual(played, quotas);
  if (special.every(id => ids.includes(id))) assert.ok(opposed <= Math.min(...special.map(id => quotas[id])) - 1);
  return opposed;
}

test('daily rotation preserves quotas and rest spacing for real roster sizes', () => {
  const members = players.slice(0, 14).map(p => p.id);
  const strengths = initialStrengths(members, baseline);
  for (const count of [8, 10, 12, 14]) for (const rounds of [4, 6]) for (const seed of [7, 73, 2026]) {
    const ids = [...special, ...members.filter(id => !special.includes(id)).slice(0, count - 2)];
    const slots = rounds * 8;
    const quotas = Object.fromEntries(ids.map((id, i) => [id, Math.floor(slots / count) + Number(i < slots % count)]));
    const result = generateSchedule(ids, quotas, { strengths, random: seeded(seed) });
    verify(result, ids, quotas);
    assert.equal(result.consecutiveRests, 0, `${count}/${rounds}/${seed}`);
  }
});

test('four players in three games meet as opponents twice and as partners once', () => {
  const ids = [...special, 'a', 'b'];
  const quotas = Object.fromEntries(ids.map(id => [id, 3]));
  for (const seed of [7, 73, 2026]) assert.equal(verify(generateSchedule(ids, quotas, { random: seeded(seed) }), ids, quotas), 2);
});

test('partner rule remains active when only one rotating player attends', () => {
  for (const id of special) {
    const ids = [id, 'a', 'b', 'c'];
    const quotas = Object.fromEntries(ids.map(id => [id, 3]));
    verify(generateSchedule(ids, quotas, { random: seeded(73) }), ids, quotas);
  }
});

test('conflicting fixed pairs and impossible partner counts produce explicit errors', () => {
  const ids = [...special, 'a', 'b'];
  const quotas = Object.fromEntries(ids.map(id => [id, 3]));
  assert.throws(() => generateSchedule(ids, quotas, { lockedPairs: [[special[0], 'a']] }), /고정 페어/);
  assert.throws(() => generateSchedule(ids, Object.fromEntries(ids.map(id => [id, 4]))), /파트너가 중복되지/);
  // Existing preparation-pair fallback may relax the OTHER players' pair,
  // but must keep the daily rules for both rotating players.
  verify(generateSchedule(ids, quotas, { lockedPairs: [['a', 'b']], random: seeded(7) }), ids, quotas);
});

test('feasible preparation pairs outside the rotating players remain fixed', () => {
  const ids = players.slice(0, 14).map(p => p.id);
  const quotas = Object.fromEntries(ids.map((id, i) => [id, 2 + Number(i < 4)]));
  const lockedPairs = [['gdr001', 'gdr002']];
  const result = generateSchedule(ids, quotas, { lockedPairs, random: seeded(73) });
  verify(result, ids, quotas);
  for (const match of Object.values(result.matchMap)) for (const team of [match.teamA, match.teamB]) {
    if (team.includes('gdr001')) assert.ok(team.includes('gdr002'));
  }
});
