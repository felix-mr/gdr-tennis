import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule } from '../src/scheduler.js';
import { initialStrengths } from '../src/ratings.js';
import players from '../data/players.json' with { type: 'json' };
import baseline from '../data/strength-baseline.json' with { type: 'json' };

const special = ['gdr011', 'gdr010'];
function seeded(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function verify(result, ids, quotas) {
  let opposed = 0;
  const played = Object.fromEntries(ids.map(id => [id, 0]));
  const exposures = {}, active = {};
  for (const match of Object.values(result.matchMap)) {
    active[match.round] ??= new Set();
    for (const team of [match.teamA, match.teamB]) for (const id of team) {
      assert.ok(!active[match.round].has(id));
      active[match.round].add(id);
      played[id]++;
      if (!special.includes(id) && team.some(other => special.includes(other))) {
        exposures[id] ??= [];
        exposures[id].push(team.find(other => other !== id));
      }
    }
    if (match.teamA.includes(special[0]) && match.teamB.includes(special[1]) || match.teamA.includes(special[1]) && match.teamB.includes(special[0])) opposed++;
  }
  assert.deepEqual(played, quotas);
  return { opposed, exposures };
}

test('combined rotation preserves quotas and rest spacing for real roster sizes', () => {
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

test('partnering with Jaehyeok also counts against partnering with Geunhwa on the same day', () => {
  const ids = [...special, 'a', 'b', 'c', 'd', 'e', 'f'];
  const quotas = Object.fromEntries(ids.map(id => [id, 3]));
  for (const seed of [7, 73, 2026]) {
    const result = generateSchedule(ids, quotas, { random: seeded(seed) });
    const { exposures, opposed } = verify(result, ids, quotas);
    assert.ok(Object.values(exposures).every(list => list.length <= 1));
    assert.ok(opposed <= 2);
  }
});

test('four players in three games prefer at least one non-opposing game', () => {
  const ids = [...special, 'a', 'b'];
  const quotas = Object.fromEntries(ids.map(id => [id, 3]));
  for (const seed of [7, 73, 2026]) {
    const { opposed } = verify(generateSchedule(ids, quotas, { random: seeded(seed) }), ids, quotas);
    assert.ok(opposed <= 2);
  }
});

test('one rotating player still prefers different partners when available', () => {
  for (const id of special) {
    const ids = [id, 'a', 'b', 'c'];
    const quotas = Object.fromEntries(ids.map(id => [id, 3]));
    const { exposures } = verify(generateSchedule(ids, quotas, { random: seeded(73) }), ids, quotas);
    assert.ok(Object.values(exposures).every(list => list.length <= 1));
  }
});

test('limited attendance allows repeated partners instead of refusing to generate', () => {
  const ids = [...special, 'a', 'b'];
  const quotas = Object.fromEntries(ids.map(id => [id, 6]));
  const result = generateSchedule(ids, quotas, { random: seeded(73) });
  const { exposures } = verify(result, ids, quotas);
  assert.ok(Object.values(exposures).some(list => list.length > 1));
});

test('explicit preparation pairs override both daily preferences', () => {
  const ids = [...special, 'a', 'b'];
  const quotas = Object.fromEntries(ids.map(id => [id, 3]));
  const lockedPairs = [[special[0], 'a'], [special[1], 'b']];
  const result = generateSchedule(ids, quotas, { lockedPairs, random: seeded(73) });
  const { opposed } = verify(result, ids, quotas);
  assert.equal(opposed, 3);
  for (const match of Object.values(result.matchMap)) for (const team of [match.teamA, match.teamB]) {
    assert.ok(lockedPairs.some(pair => pair.every(id => team.includes(id))));
  }
});
