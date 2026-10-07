import test from 'node:test';
import assert from 'node:assert/strict';
import { ranking, recordsFrom, validateSession, quarter, validDate, nextSunday, meetingWindow } from '../src/model.js';
import { allocateGames, allocateForWindow, generateSchedule } from '../src/scheduler.js';
import players from '../data/players.json' with { type: 'json' };
let seed = 12026;
function random() { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }
test('4–14 attendees, targets 2–4: fair quotas, exact counts, no simultaneous appearances', () => {
  for (let n = 4; n <= 14; n++) for (const target of [2, 3, 4]) {
    const ids = players.slice(0, n).map(p => p.id), quotas = allocateGames(ids, target);
    assert.ok(Math.max(...Object.values(quotas)) - Math.min(...Object.values(quotas)) <= 1);
    const { matchMap } = generateSchedule(ids, quotas, { random, attempts: 100 });
    const session = { date: '2026-10-07', participantIds: ids, fixedPlayerIds: ids, matchMap, startTime: '08:00', roundMinutes: 30 };
    validateSession(session, ids);
    for (const id of ids) assert.equal(Object.values(matchMap).filter(m => [...m.teamA, ...m.teamB].includes(id)).length, quotas[id]);
    assert.ok(Object.values(matchMap).every(m => m.court <= 2));
  }
});
test('extra games go to people with fewer quarter games', () => {
  const ids = players.slice(0, 14).map(p => p.id), totals = Object.fromEntries(ids.map((id, i) => [id, 20 - i]));
  const quotas = allocateGames(ids, 3, totals);
  assert.deepEqual(ids.filter(id => quotas[id] === 4), ids.slice(12));
});
test('custom 2–4 quotas: reject non-divisible doubles slots', () => {
  assert.throws(() => generateSchedule(['a', 'b', 'c', 'd'], { a: 2, b: 2, c: 2, d: 3 }), /4의 배수/);
  assert.throws(() => allocateGames(['a', 'b', 'c'], 3), /4명/);
});
test('14 players x 4 games: 14 matches, no repeat partners', () => {
  const ids = players.map(p => p.id), result = generateSchedule(ids, allocateGames(ids, 4), { random });
  assert.equal(Object.keys(result.matchMap).length, 14); assert.equal(result.partnerRepeats, 0);
});
const match = { round: 1, court: 1, teamA: ['gdr001', 'gdr002'], teamB: ['gdr003', 'gdr014'], fixedPlayerIds: ['gdr001', 'gdr002', 'gdr003', 'gdr014'], date: '2026-10-07' };
test('score stats include female player in same pool; shared ranks and goals', () => {
  const records = [{ ...match, scoreA: 6, scoreB: 4, outcome: 'teamA' }, { ...match, scoreA: 3, scoreB: 3, outcome: 'draw' }];
  const rows = ranking(records, players), winner = rows.find(r => r.id === 'gdr001'), loser = rows.find(r => r.id === 'gdr014');
  assert.equal(winner.points, 4); assert.equal(winner.scored, 9); assert.equal(winner.conceded, 7); assert.equal(winner.winRate, 50);
  assert.equal(winner.rank, 1); assert.equal(rows.find(r => r.id === 'gdr002').rank, 1);
  assert.equal(loser.games, 2); assert.equal(loser.draws, 1); assert.equal(loser.losses, 1);
  assert.equal(rows.find(r => r.id === 'gdr004').rank, null);
});
test('0:0 saved draw counts, unscored matches excluded, edit replaces prior result', () => {
  const ids = ['gdr001', 'gdr002', 'gdr003', 'gdr014'];
  const matchMap = { 'r1-c1': match, 'r2-c1': { ...match, round: 2 } };
  const state = { sessions: { '2026-10-07': { date: '2026-10-07', fixedPlayerIds: ids, matchMap } }, results: {} };
  assert.equal(recordsFrom(state).length, 0);
  state.results['2026-10-07_r1-c1'] = { scoreA: 0, scoreB: 0, outcome: 'draw' };
  assert.equal(ranking(recordsFrom(state), players).find(r => r.id === 'gdr001').points, 1);
  state.results['2026-10-07_r1-c1'] = { scoreA: 6, scoreB: 4, outcome: 'teamA' };
  assert.equal(ranking(recordsFrom(state), players).find(r => r.id === 'gdr001').points, 3);
  assert.equal(recordsFrom(state).length, 1);
});
test('calendar quarter and real date validation', () => {
  assert.equal(quarter('2026-10-07'), '2026-Q4'); assert.equal(quarter('2027-01-01'), '2027-Q1');
  assert.equal(validDate('2026-02-30'), false); assert.equal(validDate('2026-10-07'), true);
});

test('meeting window determines quotas without target selector', () => {
  const ids = players.map(p => p.id), quotas = allocateForWindow(ids, 6);
  assert.equal(Object.values(quotas).reduce((a, b) => a + b), 48);
  assert.equal(Object.values(quotas).filter(n => n === 4).length, 6);
  const result = generateSchedule(ids, quotas, { random });
  assert.ok(Math.max(...Object.values(result.matchMap).map(m => m.round)) <= 6);
  assert.throws(() => allocateForWindow(ids, 1), /시간/);
  assert.throws(() => allocateForWindow(ids, 0), /종료 시간/);
});
test('all feasible windows fit for 4–14 attendees', () => {
  for (let n = 4; n <= 14; n++) for (let rounds = 2; rounds <= 7; rounds++) {
    const ids = players.slice(0, n).map(p => p.id), capacity = rounds * (n >= 8 ? 8 : 4);
    if (capacity < n) continue;
    const quotas = allocateForWindow(ids, rounds);
    const result = generateSchedule(ids, quotas, { random, attempts: 100 });
    assert.ok(Math.max(...Object.values(result.matchMap).map(m => m.round)) <= rounds);
  }
});
test('two strong and two weak players form balanced teams', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const result = generateSchedule(ids, { a: 2, b: 2, c: 2, d: 2 }, { strengths: { a: 1, b: 1, c: 0, d: 0 }, random, attempts: 30 });
  assert.equal(result.balance.averageGap, 0); assert.equal(result.partnerRepeats, 0);
  for (const m of Object.values(result.matchMap)) assert.ok(m.teamA.some(id => ['a', 'b'].includes(id)) && m.teamB.some(id => ['a', 'b'].includes(id)));
});
test('8 players: team strength balance, exact games and distinct partners', () => {
  const ids = players.slice(0, 8).map(p => p.id);
  const strengths = Object.fromEntries(ids.map((id, i) => [id, i < 4 ? 1 : 0]));
  const result = generateSchedule(ids, allocateGames(ids, 4), { strengths, random, attempts: 100 });
  assert.equal(result.balance.averageGap, 0); assert.equal(result.partnerRepeats, 0);
  for (const id of ids) assert.equal(Object.values(result.matchMap).filter(m => [...m.teamA, ...m.teamB].includes(id)).length, 4);
});
test('invalid strength snapshots cannot enter imported sessions', () => {
  const ids = players.slice(0, 4).map(p => p.id);
  const session = { date: '2026-10-07', participantIds: ids, fixedPlayerIds: ids, startTime: '08:00', roundMinutes: 30, matchMap: generateSchedule(ids, allocateGames(ids, 2), { random, attempts: 10 }).matchMap, strengths: { gdr001: 'bad' } };
  assert.throws(() => validateSession(session, ids), /전력값/);
});

test('Sunday evening club date defaults to next Sunday in Korea', () => {
  assert.equal(nextSunday('2026-10-07'), '2026-10-11');
  assert.equal(nextSunday('2026-10-11'), '2026-10-11');
});
test('preparation pair stays together and receives same number of games', () => {
  const ids = players.map(p => p.id), lockedPairs = [[ids[0], ids[1]], [ids[2], ids[3]]];
  const quotas = allocateForWindow(ids, 4, lockedPairs);
  for (const [a, b] of lockedPairs) assert.equal(quotas[a], quotas[b]);
  const result = generateSchedule(ids, quotas, { random, lockedPairs, attempts: 100 });
  for (const [a, b] of lockedPairs) {
    const matches = Object.values(result.matchMap).filter(m => [...m.teamA, ...m.teamB].includes(a));
    assert.equal(matches.length, quotas[a]);
    assert.ok(matches.every(m => [m.teamA, m.teamB].some(team => team.includes(a) && team.includes(b))));
  }
});
test('odd group with two prep pairs still gives every member their games', () => {
  const ids = players.slice(0, 5).map(p => p.id), lockedPairs = [[ids[0], ids[1]], [ids[2], ids[3]]];
  const quotas = allocateForWindow(ids, 4, lockedPairs);
  const result = generateSchedule(ids, quotas, { random, lockedPairs, attempts: 80 });
  validateSession({ date: '2026-10-11', participantIds: ids, fixedPlayerIds: ids, lockedPairs, matchMap: result.matchMap, startTime: '19:00', roundMinutes: 30 }, ids);
  for (const id of ids) assert.equal(Object.values(result.matchMap).filter(m => [...m.teamA, ...m.teamB].includes(id)).length, quotas[id]);
});
test('prep pairs cannot overlap or use an absent member', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.throws(() => allocateForWindow(ids, 4, [['a', 'b'], ['b', 'c']]), /중복/);
  assert.throws(() => allocateForWindow(ids, 4, [['a', 'absent']]), /중복/);
});

test('changing Sunday hours to 19–22 gives four attendees six games each', () => {
  const ids = players.slice(0, 4).map(p => p.id), rounds = meetingWindow('19:00', '22:00');
  assert.equal(rounds, 6);
  const quotas = allocateForWindow(ids, rounds);
  assert.ok(Object.values(quotas).every(n => n === 6));
  const { matchMap } = generateSchedule(ids, quotas, { random, attempts: 30 });
  validateSession({ date: '2026-10-11', participantIds: ids, fixedPlayerIds: ids, matchMap, startTime: '19:00', endTime: '22:00', roundMinutes: 30 }, ids);
  assert.equal(Object.keys(matchMap).length, 6);
  assert.throws(() => validateSession({ date: '2026-10-11', participantIds: ids, fixedPlayerIds: ids, matchMap, startTime: '19:00', endTime: '21:00', roundMinutes: 30 }, ids), /경기/);
});

test('short sessions still give each attendee a game and daily counts differ by at most one', () => {
  for (let n = 4; n <= 14; n++) for (const rounds of [1, 2, 4, 6, 12]) {
    const ids = players.slice(0, n).map(p => p.id), slots = rounds * (n >= 8 ? 8 : 4);
    if (slots < n) { assert.throws(() => allocateForWindow(ids, rounds), /시간/); continue; }
    const quotas = Object.values(allocateForWindow(ids, rounds));
    assert.equal(quotas.reduce((sum, value) => sum + value), slots);
    assert.ok(Math.min(...quotas) >= 1 && Math.max(...quotas) <= rounds);
    assert.ok(Math.max(...quotas) - Math.min(...quotas) <= 1);
  }
});

test('daily counts stay within one game with preparation pairs and an odd number of attendees', () => {
  const ids = players.slice(0, 5).map(p => p.id), pairs = [[ids[0], ids[1]], [ids[2], ids[3]]];
  const quotas = allocateForWindow(ids, 6, pairs);
  assert.deepEqual(quotas, { [ids[0]]: 5, [ids[1]]: 5, [ids[2]]: 5, [ids[3]]: 5, [ids[4]]: 4 });
  const result = generateSchedule(ids, quotas, { random, attempts: 60, lockedPairs: pairs });
  validateSession({ date: '2026-10-11', participantIds: ids, fixedPlayerIds: ids, matchMap: result.matchMap, startTime: '19:00', endTime: '22:00', roundMinutes: 30, lockedPairs: pairs }, ids);
});

test('invalid, reversed and overnight meeting times are rejected', () => {
  assert.throws(() => meetingWindow('', '22:00'), /시간/);
  assert.throws(() => meetingWindow('25:00', '22:00'), /시간/);
  assert.throws(() => meetingWindow('19:15', '22:00'), /30분/);
  assert.throws(() => meetingWindow('19:00', '18:00'), /종료/);
  assert.throws(() => meetingWindow('19:00', '19:00'), /종료/);
  assert.throws(() => meetingWindow('23:00', '01:00'), /종료/);
  assert.equal(meetingWindow('07:00', '14:00'), 14);
});
