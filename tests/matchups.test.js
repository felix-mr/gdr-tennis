import test from 'node:test';
import assert from 'node:assert/strict';
import { personalMatchups, archivedPartnerRows } from '../src/matchups.js';
import { toFirestoreValue, fromFirestoreValue } from '../scripts/firestore-values.js';

const game = (overrides = {}) => ({ date: '2026-10-04', round: 1, court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'], scoreA: 6, scoreB: 4, outcome: 'teamA', fixedPlayerIds: ['a', 'b', 'c', 'd'], ...overrides });

test('personal results use selected player side, draws and canonical opponent pair order', () => {
  const games = [game(), game({ round: 2, teamA: ['d', 'c'], teamB: ['b', 'a'], scoreA: 6, scoreB: 3 }), game({ round: 3, scoreA: 0, scoreB: 0, outcome: 'draw' })];
  const rows = personalMatchups(games, 'a', { b: '파트너', c: '상대1', d: '상대2' });
  assert.equal(rows.partners.length, 1); assert.equal(rows.opponents.length, 1);
  assert.deepEqual([rows.total.games, rows.total.wins, rows.total.draws, rows.total.losses], [3, 1, 1, 1]);
  assert.deepEqual([rows.total.scored, rows.total.conceded, rows.total.winRate], [9, 10, 33]);
  assert.deepEqual(rows.opponents[0].names, ['상대1', '상대2']);
  assert.equal(personalMatchups(games, 'c').total.scored, 10);
});

test('guest partner identity remains meeting-local; invalid and duplicate matches excluded', () => {
  const first = game({ teamA: ['a', 'guest001'], fixedPlayerIds: ['a', 'c', 'd'], guests: { guest001: { name: '손님1' } } });
  const next = { ...first, date: '2026-10-11', guests: { guest001: { name: '손님2' } } };
  const rows = personalMatchups([first, first, next, null, game({ teamA: 'ab' }), game({ date: 'invalid' }), game({ scoreA: -1 }), game({ round: 8, teamB: ['a', 'd'] })], 'a');
  assert.equal(rows.total.games, 2); assert.equal(rows.partners.length, 2); assert.equal(rows.opponents.length, 1);
  assert.deepEqual(rows.partners.map(row => row.names[0]), ['손님1', '손님2']);
  assert.equal(personalMatchups([first], 'guest001').total.games, 0);
});

test('historical partner snapshots remain separate; ambiguous and conflicting identities excluded', () => {
  const valid = { names: ['A', 'B'], playerIds: ['a', 'b'], status: 'validated-pair-aggregate', stats: { wins: 8, draws: 1, losses: 5, games: 14 } };
  const sets = [{ id: 'old', kind: 'partner-aggregate', title: 'June snapshot', cutoff: '2026-06', rows: [valid, { ...valid, playerIds: ['a', null] }, { ...valid, status: 'quarantine' }] }];
  const rows = archivedPartnerRows(sets, 'a');
  assert.equal(rows.length, 1); assert.equal(rows[0].partnerName, 'B');
  assert.equal(rows[0].stats.games, 14); assert.equal(rows[0].datasetId, 'old');
  assert.equal(personalMatchups([], 'a').total.games, 0);
});

test('Firestore archive preserves numbers, source cells and null identity without nested arrays', () => {
  const data = { schemaVersion: 1, source: { cells: { r1c1: '진우', r2c1: 0, r2c2: 0.5 } }, rows: [{ ids: ['a', null], valid: false, issues: [] }] };
  assert.deepEqual(fromFirestoreValue(toFirestoreValue(data)), data);
  assert.throws(() => toFirestoreValue([[1, 2]]), /nested arrays/);
  assert.throws(() => toFirestoreValue({ invalid: undefined }), /Unsupported/);
});
