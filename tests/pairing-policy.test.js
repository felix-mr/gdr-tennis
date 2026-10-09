import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule } from '../src/scheduler.js';
import { recentPairingHistory, STRENGTH_STEP, courtSeparationCost } from '../src/pairing-policy.js';

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const strengths = Object.fromEntries(ids.map((id, index) => [id, index < 4 ? 0.9 : 0.1]));
const prior = date => ({ date, participantIds: ids, fixedPlayerIds: ids, matchMap: {
  'r1-c1': { round: 1, court: 1, teamA: ['a', 'e'], teamB: ['b', 'f'] },
  'r1-c2': { round: 1, court: 2, teamA: ['c', 'g'], teamB: ['d', 'h'] },
  'r2-c1': { round: 2, court: 1, teamA: ['a', 'e'], teamB: ['c', 'g'] },
  'r2-c2': { round: 2, court: 2, teamA: ['b', 'f'], teamB: ['d', 'h'] },
} });
function seeded(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }

test('court similarity remains a bounded preference rather than requiring every team to have the same total', () => {
  const value = id => strengths[id];
  const sameCourts = ['a', 'b', 'e', 'f', 'c', 'd', 'g', 'h'];
  const separated = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const modest = ['a', 'b', 'c', 'e', 'd', 'f', 'g', 'h'];
  assert.equal(courtSeparationCost(sameCourts, value), 0);
  assert.ok(courtSeparationCost(separated, value) > courtSeparationCost(modest, value));
  assert.ok(courtSeparationCost(separated, value) < 16);
  assert.equal(courtSeparationCost(ids.slice(0, 4), value), 0);
});

test('recent pairing evidence excludes another half, future dates, duplicated days and reused guest identities', () => {
  const date = '2026-10-11', recent = prior('2026-10-04');
  const expected = recentPairingHistory([recent], date, ids);
  assert.deepEqual(recentPairingHistory([recent, recent, prior('2026-03-01'), prior(date), prior('2026-10-18')], date, ids), expected);
  const withGuest = { ...recent, participantIds: [...ids, 'guest001'], matchMap: { r1: { teamA: ['a', 'guest001'], teamB: ['b', 'f'] } } };
  const history = recentPairingHistory([withGuest], date, [...ids, 'guest001']);
  assert.ok(!Object.keys(history.partners).some(key => key.includes('guest001')));
  assert.ok(!Object.keys(history.opponents).some(key => key.includes('guest001')));
  assert.ok(expected.partners['a|e'] > expected.partners['a|b']);
});

test('only six most recent eligible meetings affect pair rotation', () => {
  const recent = ['2026-10-04', '2026-09-27', '2026-09-20', '2026-09-13', '2026-09-06', '2026-08-30'].map(prior);
  assert.deepEqual(recentPairingHistory([...recent, prior('2026-08-23')], '2026-10-11', ids), recentPairingHistory(recent, '2026-10-11', ids));
});

test('recent repeated mixed pairs can give way to similar-level foursomes without widening opposing team gaps', () => {
  const previousSchedules = ['2026-10-04', '2026-09-27', '2026-09-20', '2026-09-13', '2026-09-06', '2026-08-30'].map(date => {
    const matchMap = {};
    for (let round = 0; round < 4; round++) {
      const teams = ids.slice(0, 4).map((id, index) => [id, ids[4 + (index + round) % 4]]);
      const rotated = [...teams.slice(round), ...teams.slice(0, round)];
      matchMap[`r${round + 1}-c1`] = { round: round + 1, court: 1, teamA: rotated[0], teamB: rotated[1] };
      matchMap[`r${round + 1}-c2`] = { round: round + 1, court: 2, teamA: rotated[2], teamB: rotated[3] };
    }
    return { ...prior(date), matchMap };
  });
  const result = generateSchedule(ids, Object.fromEntries(ids.map(id => [id, 2])), { strengths, previousSchedules, meetingDate: '2026-10-11', random: seeded(2026) });
  const matches = Object.values(result.matchMap);
  assert.equal(result.consecutiveRests, 0);
  assert.equal(result.partnerRepeats, 0);
  assert.ok(matches.some(match => [...match.teamA, ...match.teamB].every(id => strengths[id] === 0.9)));
  assert.ok(matches.some(match => [...match.teamA, ...match.teamB].every(id => strengths[id] === 0.1)));
  assert.ok(result.balance.maxGap < 1e-9);
});

test('high historical repetition cannot outweigh a large opposing team mismatch', () => {
  const four = ['a', 'b', 'e', 'f'], quotas = Object.fromEntries(four.map(id => [id, 4]));
  const previousSchedules = Array.from({ length: 6 }, (_, i) => ({ date: `2026-09-${String(27 - i).padStart(2, '0')}`, participantIds: four, fixedPlayerIds: four, matchMap: { r1: { teamA: ['a', 'e'], teamB: ['b', 'f'] }, r2: { teamA: ['a', 'f'], teamB: ['b', 'e'] } } }));
  const result = generateSchedule(four, quotas, { strengths, previousSchedules, meetingDate: '2026-10-11', random: seeded(7) });
  assert.ok(result.balance.maxGap / STRENGTH_STEP <= 2 + 1e-8);
  for (const match of Object.values(result.matchMap)) for (const team of [match.teamA, match.teamB]) assert.equal(team.filter(id => strengths[id] === 0.9).length, 1);
});

test('fixed preparation pairs survive conflicting rotation history and unlike ratings', () => {
  const lockedPairs = [['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']];
  const result = generateSchedule(ids, Object.fromEntries(ids.map(id => [id, 2])), { strengths, lockedPairs, previousSchedules: [prior('2026-10-04')], meetingDate: '2026-10-11', random: seeded(73) });
  for (const match of Object.values(result.matchMap)) for (const team of [match.teamA, match.teamB]) assert.ok(lockedPairs.some(pair => pair.every(id => team.includes(id))));
  assert.equal(result.balance.maxGap, 0);
});
