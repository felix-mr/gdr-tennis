import test from 'node:test';
import assert from 'node:assert/strict';
import { GUEST_STRENGTH, normalizeGuestName, validateGuests, sessionNames } from '../src/guests.js';
import { validateSession, recordsFrom, ranking } from '../src/model.js';
import { allocateForWindow, generateSchedule } from '../src/scheduler.js';
import { encodeSession, encodeRounds, decodeSession } from '../src/session-codec.js';
import { strengthsForSession, initialStrengths } from '../src/ratings.js';
import { scheduleImagePages } from '../src/schedule-image.js';

const players = ['a', 'b', 'c'].map(id => ({ id, name: id.toUpperCase() }));
const ids = ['a', 'b', 'c', 'guest001'], guests = { guest001: { name: '홍길동' } };
const match = { round: 1, court: 1, teamA: ['a', 'guest001'], teamB: ['b', 'c'] };
const session = { schemaVersion: 1, date: '2026-10-11', startTime: '19:00', endTime: '20:00', roundMinutes: 30, participantIds: ids, fixedPlayerIds: ['a', 'b', 'c'], guests, lockedPairs: [], partnerRepeats: 0, matchMap: { 'r1-c1': match, 'r2-c1': { ...match, round: 2 } } };

test('guest names are validated; unregistered identities and guests counted as members are rejected', () => {
  assert.equal(normalizeGuestName('  홍   길동  '), '홍 길동');
  assert.deepEqual(validateGuests(guests), guests);
  for (const invalid of [{ guest009: { name: '김게스트' } }, { guest001: { name: '' } }, { guest001: { name: '  ' } }, { guest001: { name: '홍길동', rating: 1 } }, { guest001: { name: '홍길동' }, guest002: { name: '홍길동' } }, { guest001: { name: '가'.repeat(13) } }]) assert.throws(() => validateGuests(invalid), /게스트/);
  validateSession(session, ['a', 'b', 'c']);
  assert.throws(() => validateSession({ ...session, guests: {} }, ['a', 'b', 'c']), /형식/);
  assert.throws(() => validateSession({ ...session, fixedPlayerIds: ids }, ['a', 'b', 'c']), /형식/);
  assert.deepEqual(decodeSession(encodeSession(session), Object.values(encodeRounds(session))), session);
});

test('guest names survive saved records and image export without entering member rankings', () => {
  const records = recordsFrom({ sessions: { [session.date]: session }, results: { '2026-10-11_r1-c1': { scoreA: 6, scoreB: 4, outcome: 'teamA' } } });
  assert.equal(records[0].guests.guest001.name, '홍길동');
  const rows = ranking(records, [...players, { id: 'guest001', name: '홍길동' }]);
  assert.equal(rows.find(row => row.id === 'a').points, 3);
  assert.equal(rows.find(row => row.id === 'guest001').games, 0);
  const names = Object.fromEntries(players.map(player => [player.id, player.name]));
  assert.equal(sessionNames(session, names).guest001, '홍길동');
  const image = scheduleImagePages(session, names)[0];
  assert.ok(image.rounds[0].matches[0].teamA.includes('홍길동'));
  assert.equal(image.members.find(member => member.id === 'guest001').games, 2);
});

test('guests receive at least two games and use the supplied above-middle prior in member observations', () => {
  const generated = generateSchedule(ids, allocateForWindow(ids, 2), { attempts: 10, strengths: { guest001: GUEST_STRENGTH } });
  validateSession({ ...session, matchMap: generated.matchMap }, ['a', 'b', 'c']);
  assert.equal(Object.values(generated.matchMap).filter(match => [...match.teamA, ...match.teamB].includes('guest001')).length, 2);
  assert.equal(GUEST_STRENGTH, 0.65);
  const record = { ...match, date: '2026-10-11', scoreA: 6, scoreB: 4, outcome: 'teamA', fixedPlayerIds: ['a', 'b', 'c'], guests };
  const values = strengthsForSession([record], ['a', 'b', 'c'], {}, '2026-10-18');
  const expected = 1 / (1 + Math.exp(-4 * ((0.5 + GUEST_STRENGTH) / 2 - 0.5)));
  assert.ok(Math.abs(values.a - (0.5 + (1 - expected) / (1 + 24 ** 2))) < 1e-10);
  assert.equal(values.guest001, undefined);
  assert.deepEqual(strengthsForSession([{ ...record, guests: {} }], ['a', 'b', 'c'], {}, '2026-10-18'), initialStrengths(['a', 'b', 'c']));
});
