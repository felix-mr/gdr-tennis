import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSession, encodeRounds, decodeSession } from '../src/session-codec.js';

const match = { round: 1, court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'] };
const session = { schemaVersion: 1, date: '2026-10-11', participantIds: ['a', 'b', 'c', 'd'], fixedPlayerIds: ['a', 'b', 'c', 'd'], startTime: '19:00', endTime: '20:00', roundMinutes: 30, partnerRepeats: 0, lockedPairs: [['a', 'b']], matchMap: { 'r1-c1': match, 'r2-c1': { ...match, round: 2 } } };
test('header and immutable round documents preserve application/backup format', () => {
  const header = encodeSession(session), rounds = Object.values(encodeRounds(session));
  assert.equal(header.schemaVersion, 2);
  assert.equal(header.matchMap, undefined);
  assert.deepEqual(decodeSession(header, rounds), session);
  assert.deepEqual(decodeSession({ ...session, lockedPairs: [{ first: 'a', second: 'b' }] }), session);
});
test('incomplete, duplicate or mismatched round documents cannot appear as a saved schedule', () => {
  const header = encodeSession(session), rounds = Object.values(encodeRounds(session));
  assert.throws(() => decodeSession(header, rounds.slice(0, 1)), /라운드/);
  assert.throws(() => decodeSession(header, [rounds[0], rounds[0]]), /라운드/);
  assert.throws(() => decodeSession(header, [rounds[0], { ...rounds[1], round: 3 }]), /라운드/);
  assert.throws(() => decodeSession(header, [rounds[0], { ...rounds[1], matchMap: { 'r2-c1': match } }]), /라운드/);
});
