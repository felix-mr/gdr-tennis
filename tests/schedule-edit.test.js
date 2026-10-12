import test from 'node:test';
import assert from 'node:assert/strict';
import { swapAssignments, manualScheduleNotes } from '../src/schedule-edit.js';
import { validateSession } from '../src/model.js';

const members = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const full = () => ({ date: '2026-10-18', startTime: '19:00', endTime: '20:00', roundMinutes: 30, participantIds: members, fixedPlayerIds: members, lockedPairs: [], matchMap: Object.fromEntries([1, 2].flatMap(round => [1, 2].map(court => [`r${round}-c${court}`, { round, court, teamA: members.slice((court - 1) * 4, (court - 1) * 4 + 2), teamB: members.slice((court - 1) * 4 + 2, court * 4) }]))) });
const player = (matchId, side, index, playerId) => ({ kind: 'player', matchId, side, index, playerId });
const team = (matchId, side, playerIds) => ({ kind: 'team', matchId, side, playerIds });
const resting = () => {
  const participantIds = members.slice(0, 6), pairs = [[['a', 'b'], ['c', 'd']], [['e', 'f'], ['a', 'c']], [['c', 'd'], ['e', 'f']], [['a', 'b'], ['e', 'f']]];
  return { date: '2026-10-18', startTime: '19:00', endTime: '21:00', roundMinutes: 30, participantIds, fixedPlayerIds: participantIds, lockedPairs: [], matchMap: Object.fromEntries(pairs.map(([teamA, teamB], index) => [`r${index + 1}-c1`, { round: index + 1, court: 1, teamA, teamB }])) };
};

test('individual slot swap preserves total games and metadata without mutating source', () => {
  const original = full(), copy = structuredClone(original);
  const changed = swapAssignments(original, player('r1-c1', 'teamA', 0, 'a'), player('r1-c2', 'teamA', 0, 'e'));
  assert.deepEqual(original, copy);
  assert.deepEqual(changed.matchMap['r1-c1'].teamA, ['e', 'b']);
  assert.deepEqual(changed.matchMap['r1-c2'].teamA, ['a', 'f']);
  assert.deepEqual(manualScheduleNotes(changed).games, Object.fromEntries(members.map(id => [id, 2])));
  validateSession(changed, members);
});

test('cross-round collision is rejected and leaves source intact', () => {
  const original = full(), copy = structuredClone(original);
  assert.throws(() => swapAssignments(original, player('r1-c1', 'teamA', 0, 'a'), player('r2-c2', 'teamA', 0, 'e')), /중복 출전/);
  assert.deepEqual(original, copy);
});

test('fixed pair members move together as a team and cannot be split by individual swap', () => {
  const original = { ...full(), lockedPairs: [['a', 'b']] };
  assert.throws(() => swapAssignments(original, player('r1-c1', 'teamA', 0, 'a'), player('r1-c2', 'teamA', 0, 'e')), /고정 페어/);
  const changed = swapAssignments(original, team('r1-c1', 'teamA', ['a', 'b']), team('r1-c2', 'teamA', ['e', 'f']));
  assert.deepEqual(changed.matchMap['r1-c2'].teamA, ['a', 'b']);
  assert.deepEqual(changed.lockedPairs, original.lockedPairs);
  assert.equal(changed.partnerRepeats, 3);
});

test('same-round rest substitution recalculates counts and warns about uneven games', () => {
  const original = resting();
  const changed = swapAssignments(original, player('r4-c1', 'teamA', 0, 'a'), { kind: 'rest', round: 4, playerId: 'c' });
  assert.deepEqual(changed.matchMap['r4-c1'].teamA, ['c', 'b']);
  const notes = manualScheduleNotes(changed);
  assert.equal(notes.games.a, 2); assert.equal(notes.games.c, 4);
  assert.ok(notes.notes.some(note => note.includes('경기 수 차이')));
  assert.throws(() => swapAssignments(original, player('r4-c1', 'teamA', 1, 'b'), { kind: 'rest', round: 4, playerId: 'c' }), /최소 2경기/);
  assert.throws(() => swapAssignments(original, player('r4-c1', 'teamA', 0, 'a'), { kind: 'rest', round: 1, playerId: 'e' }), /같은 라운드/);
});

test('teams sharing one member can swap across rounds if no player is double-booked', () => {
  const original = resting();
  const changed = swapAssignments(original, team('r2-c1', 'teamB', ['a', 'c']), team('r4-c1', 'teamA', ['a', 'b']));
  assert.deepEqual(changed.matchMap['r2-c1'].teamB, ['a', 'b']);
  assert.deepEqual(changed.matchMap['r4-c1'].teamA, ['a', 'c']);
  assert.deepEqual(manualScheduleNotes(changed).games, manualScheduleNotes(original).games);
  validateSession(changed, original.fixedPlayerIds);
});

test('stale, duplicate, invalid and mismatched selection kinds are rejected', () => {
  const original = full(), a = player('r1-c1', 'teamA', 0, 'a');
  for (const slot of [player('missing', 'teamA', 0, 'a'), player('r1-c1', 'teamX', 0, 'a'), player('r1-c1', 'teamA', 2, 'a'), player('r1-c1', 'teamA', 0, 'b'), team('r1-c2', 'teamA', ['f', 'e']), { kind: 'rest', round: 1, playerId: 'a' }]) assert.throws(() => swapAssignments(original, a, slot));
  assert.throws(() => swapAssignments(original, a, player('r2-c1', 'teamA', 0, 'a')), /서로 다른/);
  assert.throws(() => swapAssignments(original, a, team('r1-c2', 'teamA', ['e', 'f'])), /같은 종류/);
});

test('guest slots participate in manual swaps without changing guest identity', () => {
  const original = full();
  original.participantIds = [...members.slice(0, 7), 'guest001'];
  original.fixedPlayerIds = members.slice(0, 7);
  original.guests = { guest001: { name: '게스트' } };
  for (const match of Object.values(original.matchMap)) match.teamB = match.teamB.map(id => id === 'h' ? 'guest001' : id);
  const changed = swapAssignments(original, player('r1-c1', 'teamA', 0, 'a'), player('r1-c2', 'teamB', 1, 'guest001'));
  assert.deepEqual(changed.guests, original.guests);
  assert.equal(manualScheduleNotes(changed).games.guest001, 2);
  validateSession(changed, members);
});

test('long gaps between games are reported without treating early finishes as waiting', () => {
  const original = resting();
  assert.deepEqual(manualScheduleNotes(full()).resting, []);
  assert.deepEqual(manualScheduleNotes(original).resting, ['b']);
  // B plays rounds 1 and 4; exactly two resting rounds in between.
  const adjusted = structuredClone(original);
  adjusted.matchMap['r2-c1'].teamB = ['a', 'd'];
  adjusted.matchMap['r3-c1'].teamA = ['c', 'b'];
  // D finishes after round 2; later idle rounds are not waiting between games.
  assert.deepEqual(manualScheduleNotes(adjusted).resting, []);
});
