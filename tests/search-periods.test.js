import test from 'node:test';
import assert from 'node:assert/strict';
import { withinPeriod, quarterBounds, periodLabel } from '../src/periods.js';
import { matchesName, matchesPlayer, matchesRecord } from '../src/search.js';
import { membersForPeriod } from '../src/roster.js';
import players from '../data/players.json' with { type: 'json' };
import periods from '../data/periods.json' with { type: 'json' };

test('name search handles decomposed Korean, spacing and short names', () => {
  assert.ok(matchesName('김민종', ' 김 민 '));
  assert.ok(matchesName('김민종', '민종'.normalize('NFD')));
  assert.ok(matchesPlayer({ name: '심진우', shortName: '진우' }, '진우'));
  assert.equal(matchesPlayer({ name: '김민종' }, '상재'), false);
});

test('guest search resolves identity within each meeting', () => {
  const member = { id: 'gdr001', name: '김민종', shortName: '민종' };
  const record = { teamA: ['gdr001', 'guest001'], teamB: ['gdr002', 'gdr003'], guests: { guest001: { name: '방문손님' } } };
  assert.ok(matchesRecord(record, [member], '민종'));
  assert.ok(matchesRecord(record, [member], '방문'));
  assert.equal(matchesRecord({ ...record, guests: { guest001: { name: '다른사람' } } }, [member], '방문'), false);
  assert.ok(matchesRecord(record, [member], ' '));
});

test('custom date query includes both ends, rejects reversed range and handles quarter year rollover', () => {
  const range = { start: '2026-09-30', end: '2026-10-04' };
  assert.ok(withinPeriod(range, range.start));
  assert.ok(withinPeriod(range, range.end));
  assert.equal(withinPeriod(range, '2026-09-29'), false);
  assert.equal(withinPeriod(range, '2026-10-05'), false);
  assert.equal(withinPeriod({ start: range.end, end: range.start }, '2026-10-01'), false);
  assert.equal(withinPeriod({ start: '2026-02-30', end: range.end }, '2026-10-01'), false);
  assert.deepEqual(quarterBounds('2026-Q4'), { start: '2026-10-01', endBefore: '2027-01-01' });
  assert.equal(periodLabel(range), '2026.09.30–2026.10.04');
});

test('custom roster query includes overlapping quarters and historical session members', () => {
  const earlier = [{ id: '2026-Q3', memberIds: ['gdr015'] }, ...periods];
  const sessions = { '2026-09-30': { date: '2026-09-30', fixedPlayerIds: ['gdr016'] } };
  assert.equal(membersForPeriod({ start: '2026-10-20', end: '2026-10-25' }, players, earlier, sessions).length, 14);
  const ids = membersForPeriod({ start: '2026-09-30', end: '2026-10-01' }, players, earlier, sessions).map(p => p.id);
  assert.equal(ids.length, 16);
  assert.ok(ids.includes('gdr015') && ids.includes('gdr016'));
  assert.deepEqual(membersForPeriod({ start: '2027-01-01', end: '2027-01-15' }, players, earlier, sessions), []);
});
