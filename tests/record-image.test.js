import test from 'node:test';
import assert from 'node:assert/strict';
import { withinPeriod, periodLabel } from '../src/periods.js';
import { recordImagePages } from '../src/record-image.js';
import { membersForPeriod } from '../src/roster.js';

const players = ['a', 'b', 'c', 'd'].map(id => ({ id, name: id.toUpperCase() }));
const game = (date, overrides = {}) => ({ date, round: 1, court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'], scoreA: 6, scoreB: 4, outcome: 'teamA', fixedPlayerIds: ['a', 'b', 'c', 'd'], ...overrides });
test('half-year boundaries include Q3 and Q4 but exclude H1 and the following year', () => {
  for (const date of ['2026-07-01', '2026-09-30', '2026-10-01', '2026-12-31']) assert.equal(withinPeriod('2026-H2', date), true);
  for (const date of ['2026-06-30', '2027-01-01']) assert.equal(withinPeriod('2026-H2', date), false);
  assert.equal(withinPeriod('2026-H1', '2026-06-30'), true);
  assert.equal(withinPeriod('2026-Q4', '2026-09-30'), false);
  assert.equal(withinPeriod('2026-10-04', '2026-10-11'), false);
  assert.equal(periodLabel('2026-H2'), '2026년 하반기');
  const periods = [{ id: '2026-Q3', memberIds: ['a', 'b'] }, { id: '2026-Q4', memberIds: ['c', 'd'] }];
  assert.deepEqual(membersForPeriod('2026-H2', players, periods).map(player => player.id), ['a', 'b', 'c', 'd']);
});
test('daily and cumulative pictures remain separate; invalid scores and other periods excluded', () => {
  const records = [game('2026-06-30'), game('2026-07-01'), game('2026-10-04'), game('2026-10-11', { scoreA: 0, scoreB: 0, outcome: 'draw' }), game('2026-10-04', { scoreA: -1 }), game('2027-01-01')];
  const pages = recordImagePages(records, players, '2026-H2', '2026-10-04');
  assert.equal(pages.length, 2);
  assert.equal(pages[0].rows.find(row => row.id === 'a').games, 1);
  assert.equal(pages[1].rows.find(row => row.id === 'a').games, 2);
  assert.equal(pages[1].rows.find(row => row.id === 'a').points, 6);
  assert.equal(pages[1].asOf, '2026-10-04');
  assert.equal(pages[0].filename, 'GDR-2026-10-04-results.png');
  assert.equal(pages[1].filename, 'GDR-2026-H2-ranking-2026-10-04.png');
  assert.equal(pages[1].rows[0].rank, 1); assert.equal(pages[1].rows[1].rank, 1); assert.equal(pages[1].rows[2].rank, 3);
  assert.throws(() => recordImagePages(records, players, '2026-Q4', '2026-07-01'), /期間|기간/);
  assert.throws(() => recordImagePages([], players, 'all', '2026-10-04'), /점수/);
});
test('no guest, unplayed member or internal rating appears in exported statistics', () => {
  const records = [game('2026-10-04', { teamA: ['a', 'guest001'], fixedPlayerIds: ['a', 'c', 'd'], guests: { guest001: { name: '게스트' } }, strengths: { a: 0.9 } })];
  const pages = recordImagePages(records, [...players, { id: 'guest001', name: '게스트' }], 'all', '2026-10-04');
  assert.deepEqual(pages[0].rows.map(row => row.id), ['a', 'c', 'd']);
  assert.equal(JSON.stringify(pages).includes('strengths'), false);
});
