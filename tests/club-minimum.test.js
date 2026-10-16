import test from 'node:test';
import assert from 'node:assert/strict';
import { clubMemberCount, isOfficialMeeting, recordsFrom, ranking } from '../src/model.js';
import { personalMatchups } from '../src/matchups.js';
import { initialStrengths, strengthsForSession } from '../src/ratings.js';
import { recentPairingHistory } from '../src/pairing-policy.js';
import { historyForOfficialMeetings, rankingWithHistory } from '../src/history-stats.js';
import { recordImagePages } from '../src/record-image.js';
import { scheduleImagePages } from '../src/schedule-image.js';

const ids = ['a', 'b', 'c', 'd'];
const players = ids.map(id => ({ id, name: id.toUpperCase() }));
const guests = { guest001: { name: '손님' } };
const session = (date, official) => ({ date, participantIds: official ? [...ids, 'guest001'] : ['a', 'b', 'c', 'guest001'], fixedPlayerIds: official ? ids : ['a', 'b', 'c'], guests, startTime: '19:00', endTime: '20:00', roundMinutes: 30, matchMap: { 'r1-c1': { round: 1, court: 1, teamA: ['a', 'guest001'], teamB: ['b', 'c'] } } });
const good = session('2026-10-11', true), small = session('2026-10-18', false);
const score = { scoreA: 6, scoreB: 4, outcome: 'teamA' };
const state = { sessions: { [good.date]: good, [small.date]: small }, results: { [`${good.date}_r1-c1`]: score, [`${small.date}_r1-c1`]: score } };
const raw = recordsFrom(state, { includeUnofficial: true });

test('eligibility counts unique attending club members, not guests or the four people on court', () => {
  assert.equal(clubMemberCount(good), 4);
  assert.equal(clubMemberCount(small), 3);
  assert.equal(isOfficialMeeting(good), true);
  assert.equal(isOfficialMeeting(small), false);
  assert.equal(isOfficialMeeting({ ...small, fixedPlayerIds: ['a', 'b', 'c', 'c', 'guest001'] }), false);
  assert.equal(isOfficialMeeting({ ...good, participantIds: small.participantIds }), false);
  assert.equal(isOfficialMeeting({ fixedPlayerIds: ['a', 'b', 'c', 'guest002'] }), false);
  assert.equal(isOfficialMeeting({ fixedPlayerIds: 'abcd' }), false);
  assert.equal(isOfficialMeeting({ ...small, participantIds: [...small.participantIds, 'guest002', 'guest003', 'guest004'] }), false);
});

test('raw score storage and schedule images survive while official statistics and record images exclude small meetings', () => {
  assert.equal(raw.length, 2);
  assert.equal(recordsFrom(state).length, 1);
  const row = ranking(raw, players).find(row => row.id === 'a');
  assert.equal(row.games, 1); assert.equal(row.points, 3);
  assert.equal(personalMatchups(raw, 'a').total.games, 1);
  assert.equal(recordImagePages(raw, players, '2026-H2', good.date)[1].rows.find(row => row.id === 'a').games, 1);
  assert.throws(() => recordImagePages(raw, players, '2026-H2', small.date), /점수가 입력된 모임/);
  assert.deepEqual(scheduleImagePages(small, Object.fromEntries(players.map(p => [p.id, p.name])), state.results, true)[0].rounds[0].matches[0].score, [6, 4]);
  assert.equal(state.results[`${small.date}_r1-c1`].scoreA, 6);
});

test('small meetings affect neither performance, attendance confidence nor pairing history', () => {
  const date = '2026-10-25', context = { periods: [{ id: '2026-Q4', memberIds: ids }], sessions: [good] };
  const expected = strengthsForSession(recordsFrom(state), ids, {}, date, [], context);
  assert.deepEqual(strengthsForSession(raw, ids, {}, date, [], { ...context, sessions: [good, small] }), expected);
  assert.deepEqual(strengthsForSession(raw.filter(r => r.date === small.date), ids, {}, date), initialStrengths(ids));
  assert.deepEqual(recentPairingHistory([good, small], date, ids), recentPairingHistory([good], date, ids));
});

test('known excluded dates cannot re-enter via dated imports; unverifiable legacy totals remain intact', () => {
  const daily = { id: 'small-import', kind: 'daily-individual-aggregate', datePrecision: 'day', cutoff: small.date, rows: [{ playerId: 'a', name: 'A', stats: { games: 1, wins: 1, draws: 0, losses: 0, scored: 6, conceded: 4 } }] };
  const legacy = { kind: 'individual-aggregate', period: '2026-H2', periodStart: '2026-07-01', cutoff: '2026-09-27' };
  assert.deepEqual(historyForOfficialMeetings([daily, legacy], [small]), [legacy]);
  assert.deepEqual(historyForOfficialMeetings([daily, legacy]), [daily, legacy]);
  assert.deepEqual(historyForOfficialMeetings([{ ...daily, fixedPlayerIds: small.fixedPlayerIds }]), []);
  const expected = strengthsForSession([], ids, {}, '2026-10-25');
  assert.deepEqual(strengthsForSession([], ids, {}, '2026-10-25', [daily], { sessions: [small] }), expected);
});

test('subtracting covered member rows does not turn an eligible meeting into an ineligible three-member record', () => {
  const record = { ...good.matchMap['r1-c1'], ...score, date: good.date, fixedPlayerIds: ids, guests };
  const baseline = { kind: 'individual-aggregate', aggregationRole: 'period-baseline', contributesToLiveRanking: true, datePrecision: 'day', periodStart: '2026-07-01', cutoff: good.date, rows: [{ playerId: 'a', stats: { wins: 1, draws: 0, losses: 0, scored: 6, conceded: 4 } }] };
  const rows = rankingWithHistory([record], players, '2026-H2', [baseline]);
  assert.equal(rows.find(row => row.id === 'a').games, 1);
  assert.equal(rows.find(row => row.id === 'b').games, 1);
});
