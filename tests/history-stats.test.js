import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineHistory, datedHistory, normalizeDailyRows, rankingWithHistory } from '../src/history-stats.js';
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
const q3 = { id: 'q3-close', kind: 'individual-aggregate', aggregationRole: 'period-baseline', contributesToLiveRanking: true, period: '2026-Q3', periodStart: '2026-07-01', cutoff: '2026-09-27', datePrecision: 'day', rows: [
  { playerId: 'a', name: '민종', stats: { wins: 20, draws: 1, losses: 11, scored: 162, conceded: 119 } },
  { playerId: 'b', name: '상재', stats: { wins: 25, draws: 1, losses: 9, scored: 175, conceded: 127 } },
] };
const october = { ...actual, date: '2026-10-04' };
test('Q3 close plus Q4 actual outcomes produce half-year totals without leaking into Q4 or H1', () => {
  const original = structuredClone(q3);
  const half = rankingWithHistory([october], players, '2026-H2', [q3]);
  const a = half.find(row => row.id === 'a');
  assert.deepEqual([a.points, a.games, a.scored, a.conceded, a.baselineGames], [64, 33, 168, 123, 32]);
  assert.equal(rankingWithHistory([october], players, '2026-Q3', [q3]).find(row => row.id === 'a').points, 61);
  assert.equal(rankingWithHistory([october], players, '2026-Q4', [q3]).find(row => row.id === 'a').points, 3);
  assert.equal(baselineHistory([q3], '2026-H1').length, 0);
  assert.equal(baselineHistory([q3], { start: '2026-09-01', end: '2026-10-04' }).length, 0);
  assert.equal(baselineHistory([q3], { start: '2026-07-01', end: '2026-10-04' }).length, 2);
  assert.deepEqual(q3, original);
});
test('period baseline covers only its people and date interval; duplicates and archive-only snapshots excluded', () => {
  const covered = { ...actual, date: '2026-09-21' };
  const oldDaily = { ...daily, cutoff: covered.date };
  const disabled = { ...q3, id: 'old-october-snapshot', cutoff: '2026-10-04', contributesToLiveRanking: false };
  const rows = rankingWithHistory([covered, october], players, '2026-H2', [q3, q3, oldDaily, disabled]);
  assert.equal(rows.find(row => row.id === 'a').games, 33);
  assert.equal(rows.find(row => row.id === 'c').games, 2);
  const malformed = { ...q3, rows: [{ playerId: null, stats: q3.rows[0].stats }, { ...q3.rows[1], stats: { ...q3.rows[1].stats, wins: -1 } }] };
  assert.equal(baselineHistory([malformed], '2026-H2').length, 0);
});
test('half-year shared image includes Q3 close; daily image stays daily and Q3-only export never fabricates a day', () => {
  const old = { ...actual, date: '2026-09-21' };
  const pages = recordImagePages([old, october], players, '2026-H2', october.date, [q3]);
  assert.equal(pages[0].rows.find(row => row.id === 'a').games, 1);
  assert.equal(pages[1].rows.find(row => row.id === 'a').games, 33);
  const q3Only = recordImagePages([], players, '2026-Q3', q3.cutoff, [q3]);
  assert.equal(q3Only.length, 1);
  assert.equal(q3Only[0].kind, 'cumulative');
  assert.equal(q3Only[0].rows.find(row => row.id === 'a').points, 61);
  assert.throws(() => recordImagePages([], players, '2026-Q3', '2026-09-20', [q3]), /점수/);
});
