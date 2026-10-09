import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule } from '../src/scheduler.js';

function seeded(value) {
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
const members = count => Array.from({ length: count }, (_, i) => `member${i}`);
const quotasFor = (ids, rounds) => Object.fromEntries(ids.map((id, i) => [id, Math.floor(rounds * 8 / ids.length) + Number(i < rounds * 8 % ids.length)]));
function appearances(result, id) {
  return Object.values(result.matchMap).filter(match => [...match.teamA, ...match.teamB].includes(id)).map(match => match.round);
}
function repeatedRests(result, ids, rounds, preferences = {}) {
  let total = 0;
  for (const id of ids) {
    const played = appearances(result, id);
    const start = preferences[id] === 'late' ? Math.min(...played) : 1;
    const end = preferences[id] === 'early' ? Math.max(...played) : rounds;
    let rest = 0;
    for (let round = start; round <= end; round++) {
      rest = played.includes(round) ? 0 : rest + 1;
      if (rest > 1) total++;
    }
  }
  return total;
}
function checkQuota(result, ids, quotas) {
  for (const id of ids) assert.equal(appearances(result, id).length, quotas[id]);
  for (const round of new Set(Object.values(result.matchMap).map(match => match.round))) {
    const active = Object.values(result.matchMap).filter(match => match.round === round).flatMap(match => [...match.teamA, ...match.teamB]);
    assert.equal(new Set(active).size, active.length);
  }
}

test('common attendance avoids two consecutive rests while preserving quotas and fixed pairs', () => {
  for (const count of [10, 12, 14, 16]) for (const rounds of [4, 6]) for (const seed of [7, 73, 2026]) {
    const ids = members(count), quotas = quotasFor(ids, rounds);
    const lockedPairs = [[ids[0], ids[1]]];
    const result = generateSchedule(ids, quotas, { random: seeded(seed), lockedPairs });
    checkQuota(result, ids, quotas);
    assert.equal(repeatedRests(result, ids, rounds), 0, `${count} members, ${rounds} rounds, seed ${seed}`);
    for (const match of Object.values(result.matchMap).filter(match => [...match.teamA, ...match.teamB].includes(ids[0]))) {
      assert.ok([match.teamA, match.teamB].some(team => lockedPairs[0].every(id => team.includes(id))));
    }
  }
});

test('17 members retain fair game counts and reach unavoidable consecutive-rest lower bound', () => {
  const ids = members(17), rounds = 6, quotas = quotasFor(ids, rounds);
  const result = generateSchedule(ids, quotas, { random: seeded(2026) });
  checkQuota(result, ids, quotas);
  // Two adjacent rounds can include at most 16 different players on two courts.
  assert.equal(repeatedRests(result, ids, rounds), (ids.length - 16) * (rounds - 1));
  assert.ok(Math.min(...Object.values(quotas)) >= 2);
  assert.ok(Math.max(...Object.values(quotas)) - Math.min(...Object.values(quotas)) <= 1);
});

test('optional early finish and late start influence order without changing quotas or rest spacing', () => {
  const ids = members(12), quotas = quotasFor(ids, 6);
  const preferences = Object.fromEntries(ids.map((id, index) => [id, index < 6 ? 'early' : 'late']));
  const result = generateSchedule(ids, quotas, { random: seeded(73), timingPreferences: preferences });
  checkQuota(result, ids, quotas);
  assert.equal(repeatedRests(result, ids, 6, preferences), 0);
  const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const first = group => average(group.map(id => Math.min(...appearances(result, id))));
  const last = group => average(group.map(id => Math.max(...appearances(result, id))));
  assert.ok(first(ids.slice(0, 6)) < first(ids.slice(6)));
  assert.ok(last(ids.slice(0, 6)) < last(ids.slice(6)));
  assert.throws(() => generateSchedule(ids, quotas, { timingPreferences: { absent: 'early' } }), /시작·마무리/);
  assert.throws(() => generateSchedule(ids, quotas, { timingPreferences: { [ids[0]]: 'unknown' } }), /시작·마무리/);
});
