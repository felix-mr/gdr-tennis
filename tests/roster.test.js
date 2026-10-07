import test from 'node:test';
import assert from 'node:assert/strict';
import players from '../data/players.json' with { type: 'json' };
import periods from '../data/periods.json' with { type: 'json' };
import { membersForPeriod } from '../src/roster.js';

test('club membership expands without adding former-quarter members to Q4', () => {
  assert.equal(players.length, 24);
  assert.equal(new Set(players.map(player => player.id)).size, 24);
  assert.equal(players.filter(player => player.gender === 'female').length, 1);
  assert.equal(membersForPeriod('all', players, periods).length, 24);
  assert.deepEqual(membersForPeriod('2026-Q4', players, periods).map(player => player.id), periods[0].memberIds);
  assert.equal(membersForPeriod('2026-10-11', players, periods).length, 14);
});

test('quarter rosters stay separate and saved historical membership survives later roster changes', () => {
  const earlier = [{ id: '2026-Q3', memberIds: ['gdr001', 'gdr015'] }, ...periods];
  const sessions = {
    '2026-08-02': { date: '2026-08-02', fixedPlayerIds: ['gdr016', 'gdr017'] },
    '2026-10-04': { date: '2026-10-04', fixedPlayerIds: ['gdr003', 'gdr004'] },
  };
  assert.deepEqual(membersForPeriod('2026-Q3', players, earlier, sessions).map(player => player.id), ['gdr001', 'gdr015', 'gdr016', 'gdr017']);
  assert.deepEqual(membersForPeriod('2026-08-02', players, earlier, sessions).map(player => player.id), ['gdr016', 'gdr017']);
  assert.equal(membersForPeriod('2026-Q4', players, earlier, sessions).length, 14);
  assert.deepEqual(membersForPeriod('2027-Q1', players, earlier, sessions), []);
});
