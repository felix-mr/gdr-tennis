import test from 'node:test';
import assert from 'node:assert/strict';
import { datedHistory, normalizeDailyRows, rankingWithHistory, historicalPriors } from '../src/history-stats.js';
import { recordImagePages } from '../src/record-image.js';

const players = [{ id: 'a', name: '김민종' }, { id: 'b', name: '여상재' }, { id: 'c', name: '김동주' }, { id: 'd', name: '심진우' }];
const daily = { id: 'january-4', kind: 'daily-individual-aggregate', datePrecision: 'day', cutoff: '2026-01-04', contributesToLiveRanking: true, rows: [{ playerId: 'a', name: '민종', stats: { wins: 3, draws: 1, losses: 0, games: 99, points: 99, scored: 24, conceded: 20, difference: 99 }, issues: [{ field: 'points', provided: 99, expected: 10 }] }] };
const actual = { date: daily.cutoff, round: 1, court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'], fixedPlayerIds: players.map(player => player.id), scoreA: 6, scoreB: 4, outcome: 'teamA' };

test('dated aggregates derive consistent stats without modifying original values; unconfirmed and superseded excluded', () => {
  const original = structuredClone(daily), [row] = normalizeDailyRows(daily);
  assert.deepEqual([row.games, row.points, row.difference, row.review], [4, 10, 4, true]);
  assert.deepEqual(daily, original);
  for (const source of [{ ...daily, datePrecision: 'unconfirmed' }, { ...daily, status: 'superseded' }, { ...daily, kind: 'individual-aggregate' }, { ...daily, contributesToLiveRanking: false }]) assert.equal(normalizeDailyRows(source).length, 0);
});
test('actual matches take precedence for a complete date; repeated snapshots and cumulative sources cannot double count', () => {
  assert.equal(datedHistory([daily, daily], '2026-Q1').length, 1);
  assert.equal(datedHistory([daily], '2026-Q4').length, 0);
  const rows = rankingWithHistory([actual], players, '2026-Q1', [daily, { ...daily, kind: 'individual-aggregate' }]);
  const member = rows.find(row => row.id === 'a');
  assert.deepEqual([member.games, member.points, member.scored, member.historyGames], [1, 3, 6, 0]);
  const archived = rankingWithHistory([], players, '2026-Q1', [daily]).find(row => row.id === 'a');
  assert.deepEqual([archived.games, archived.points, archived.historyGames, archived.historyReview], [4, 10, 4, true]);
});
test('dated source can produce daily and cumulative pictures with an inclusive cutoff and period guard', () => {
  const later = { ...daily, id: 'january-11', cutoff: '2026-01-11' };
  const pages = recordImagePages([], players, '2026-Q1', daily.cutoff, [daily, later]);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].rows[0].points, 10);
  assert.equal(pages[1].rows[0].points, 10);
  assert.throws(() => recordImagePages([], players, '2026-Q4', daily.cutoff, [daily]), /기간/);
});
test('career results only nudge priors before the meeting quarter; overlap and disabled sources excluded', () => {
  const priors = { a: 0.9, b: 0.1 };
  const career = { id: 'career-2026-06', kind: 'individual-aggregate', contributesToRatings: true, cutoff: '2026-06', rows: [{ playerId: 'a', stats: { wins: 200, draws: 0, losses: 0 } }, { playerId: 'b', stats: { wins: 0, draws: 0, losses: 200 } }] };
  const result = historicalPriors(priors, [career], '2026-10-11');
  assert.ok(result.a > priors.a && result.a - priors.a < 0.016);
  assert.ok(result.b < priors.b && priors.b - result.b < 0.016);
  assert.deepEqual(historicalPriors(priors, [career], '2026-04-05'), priors);
  assert.deepEqual(historicalPriors(priors, [{ ...career, cutoff: '2026-10' }], '2026-10-11'), priors);
  assert.deepEqual(historicalPriors(priors, [{ ...career, contributesToRatings: false }], '2026-10-11'), priors);
});
