import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule } from '../src/scheduler.js';
import { recentPairingHistory, STRENGTH_STEP } from '../src/pairing-policy.js';

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const strengths = Object.fromEntries(ids.map((id, index) => [id, index < 4 ? 0.9 : 0.1]));
const prior = date => ({ date, participantIds: ids, fixedPlayerIds: ids, matchMap: {
  'r1-c1': { round: 1, court: 1, teamA: ['a', 'e'], teamB: ['b', 'f'] },
  'r1-c2': { round: 1, court: 2, teamA: ['c', 'g'], teamB: ['d', 'h'] },
  'r2-c1': { round: 2, court: 1, teamA: ['a', 'e'], teamB: ['c', 'g'] },
  'r2-c2': { round: 2, court: 2, teamA: ['b', 'f'], teamB: ['d', 'h'] },
} });
function seeded(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }

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

test('fresh three-hour draws do not converge on the same replacement partners after one saved meeting', () => {
  const members = Array.from({ length: 14 }, (_, i) => `p${String(i).padStart(2, '0')}`);
  // Small result-based adjustments make the two initially equal players differ.
  // The saved-history avoidance must not funnel them into one replacement pair.
  const values = [0.907, 0.901, 0.627, 0.773, 0.769, 0.367, 0.359, 0.233, 0.502, 0.094, 0.100, 0.633, 0.498, 0.233];
  const strengths = Object.fromEntries(members.map((id, i) => [id, values[i]]));
  const matches = [[3, 2, 8, 1], [9, 5, 6, 10], [0, 5, 1, 6], [3, 8, 11, 2], [10, 0, 9, 1], [2, 6, 5, 11], [0, 6, 11, 8], [9, 3, 10, 2]];
  const participantIds = [...new Set(matches.flat())].map(i => members[i]);
  const previousSchedules = [{ date: '2026-10-04', participantIds, fixedPlayerIds: participantIds, matchMap: Object.fromEntries(matches.map((four, i) => [`r${Math.floor(i / 2) + 1}-c${i % 2 + 1}`, { round: Math.floor(i / 2) + 1, court: i % 2 + 1, teamA: four.slice(0, 2).map(i => members[i]), teamB: four.slice(2).map(i => members[i]) }])) }];
  const inclusion = [0, 0], draws = 16;
  for (let sample = 0; sample < draws; sample++) {
    const random = seeded(937 + sample * 104729);
    const extra = new Set(members.map(id => ({ id, order: random() })).sort((a, b) => a.order - b.order).slice(0, 6).map(item => item.id));
    const quotas = Object.fromEntries(members.map(id => [id, 3 + Number(extra.has(id))]));
    const result = generateSchedule(members, quotas, { strengths, previousSchedules, meetingDate: '2026-10-11', random });
    const teams = Object.values(result.matchMap).flatMap(match => [match.teamA, match.teamB]);
    for (const [i, pair] of [[0, [members[0], members[9]]], [1, [members[1], members[10]]]]) if (teams.some(team => pair.every(id => team.includes(id)))) inclusion[i]++;
    assert.equal(result.consecutiveRests, 0);
    assert.equal(result.partnerRepeats, 0);
    assert.ok(result.balance.maxGap / STRENGTH_STEP < 2.3);
    for (const id of members) assert.equal(teams.filter(team => team.includes(id)).length, quotas[id]);
  }
  assert.ok(inclusion.every(count => count < draws * 0.85), `Replacement pair inclusions: ${inclusion}`);
  // These remain independent previews, never fictitious saved meetings.
  assert.equal(previousSchedules.length, 1);
});

test('low-total games and high-total games can coexist with mixed games without any saved history', () => {
  const members = ['l1', 'l2', 'l3', 'l4', 'h1', 'h2', 'h3', 'h4'];
  const values = [0.1, 0.2, 0.1, 0.3, 0.7, 0.8, 0.7, 0.9];
  const strengths = Object.fromEntries(members.map((id, i) => [id, values[i]]));
  const result = generateSchedule(members, Object.fromEntries(members.map(id => [id, 2])), { strengths, random: seeded(2026) });
  const matches = Object.values(result.matchMap);
  const low = matches.filter(match => [...match.teamA, ...match.teamB].every(id => strengths[id] <= 0.3));
  assert.ok(low.length > 0);
  const totals = [low[0].teamA, low[0].teamB].map(team => team.reduce((sum, id) => sum + strengths[id], 0)).sort();
  assert.ok(Math.abs(totals[0] - 0.3) < 1e-9 && Math.abs(totals[1] - 0.4) < 1e-9);
  assert.ok(matches.some(match => [...match.teamA, ...match.teamB].every(id => strengths[id] >= 0.7)));
  assert.ok(matches.some(match => [...match.teamA, ...match.teamB].some(id => strengths[id] <= 0.3) && [...match.teamA, ...match.teamB].some(id => strengths[id] >= 0.7)));
  assert.equal(result.consecutiveRests, 0);
  assert.equal(result.partnerRepeats, 0);
  assert.ok(result.balance.maxGap / STRENGTH_STEP <= 2 + 1e-8);
});
