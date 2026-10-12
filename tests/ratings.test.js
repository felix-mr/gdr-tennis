import test from 'node:test';
import assert from 'node:assert/strict';
import { initialStrengths, strengthsForSession } from '../src/ratings.js';
import { generateSchedule, allocateForWindow } from '../src/scheduler.js';
import { validateSession } from '../src/model.js';
import baseline from '../data/strength-baseline.json' with { type: 'json' };
import players from '../data/players.json' with { type: 'json' };
import periods from '../data/periods.json' with { type: 'json' };
import { STRENGTH_STEP } from '../src/pairing-policy.js';
const ids = periods.find(period => period.id === '2026-Q4').memberIds, date = '2026-11-01';
const record = (teamA, teamB, outcome = 'teamA', overrides = {}) => ({ date: '2026-10-11', teamA, teamB, scoreA: outcome === 'teamB' ? 4 : 6, scoreB: outcome === 'teamA' ? 4 : 6, outcome, fixedPlayerIds: [...teamA, ...teamB], ...overrides });

test('all 14 supplied members follow six equal-value groups; no data keeps initial values', () => {
  const values = initialStrengths(ids, baseline);
  assert.equal(Object.keys(values).length, 14);
  for (let i = 0; i < baseline.groups.length; i++) {
    const [a] = baseline.groups[i];
    for (const id of baseline.groups[i]) assert.equal(values[id], values[a]);
    assert.ok(Math.abs(values[a] - (0.9 - i * STRENGTH_STEP)) < 1e-9);
    if (i) assert.ok(values[a] < values[baseline.groups[i - 1][0]]);
  }
  assert.equal(baseline.groups.length, 6);
  assert.deepEqual(baseline.groups[4], ['gdr006', 'gdr007', 'gdr014', 'gdr008']);
  assert.deepEqual(strengthsForSession([], ids, baseline, date), values);
  const reversed = initialStrengths(ids, { ...baseline, groups: [...baseline.groups].reverse() });
  assert.ok(reversed.gdr011 > reversed.gdr001);
});

test('adding club members preserves Q4 priors and keeps unconfigured members neutral', () => {
  const values = initialStrengths(players.map(player => player.id), baseline);
  const existing = initialStrengths(ids, baseline);
  for (const player of players) assert.equal(values[player.id], existing[player.id] ?? 0.5);
});

test('one unexpected result stays close to prior; sustained outcomes can change original order', () => {
  const upset = record(['gdr011', 'gdr010'], ['gdr001', 'gdr002']);
  const priors = initialStrengths(ids, baseline);
  const one = strengthsForSession([upset], ids, baseline, date);
  assert.ok(one.gdr011 > priors.gdr011 && one.gdr011 - priors.gdr011 < 0.002);
  assert.ok(one.gdr001 > one.gdr011);
  const many = strengthsForSession(Array(24).fill(upset), ids, baseline, date);
  assert.ok(many.gdr011 > many.gdr001);
  assert.equal(many.gdr014, priors.gdr014);
});

test('confidence increases with games, without rewarding attendance alone', () => {
  const draw = record(['gdr001', 'gdr011'], ['gdr002', 'gdr010'], 'draw');
  const priors = initialStrengths(ids, baseline);
  assert.deepEqual(strengthsForSession(Array(24).fill(draw), ids, baseline, date), priors);
  const win = record(['gdr013', 'gdr009'], ['gdr006', 'gdr007']);
  const four = strengthsForSession(Array(4).fill(win), ids, baseline, date);
  const twelve = strengthsForSession(Array(12).fill(win), ids, baseline, date);
  assert.ok(twelve.gdr013 > four.gdr013 && four.gdr013 > priors.gdr013);
  assert.ok(four.gdr013 - priors.gdr013 < 0.011);
});

test('a win against higher rated teams provides more evidence than an expected win', () => {
  const strong = record(['gdr013', 'gdr009'], ['gdr001', 'gdr002']);
  const weak = record(['gdr013', 'gdr009'], ['gdr011', 'gdr010']);
  assert.ok(strengthsForSession([strong], ids, baseline, date).gdr013 > strengthsForSession([weak], ids, baseline, date).gdr013);
});

test('exclude other half-years, same/future date, invalid score, duplicate player and unknown IDs', () => {
  const good = record(['gdr001', 'gdr002'], ['gdr011', 'gdr010']);
  const invalid = [
    { ...good, date: '2026-06-28' }, { ...good, date }, { ...good, date: '2026-11-08' },
    { ...good, scoreA: -1 }, { ...good, outcome: 'draw' },
    { ...good, teamB: ['gdr001', 'gdr010'] }, { ...good, teamA: ['unknown', 'gdr002'] },
    { ...good, fixedPlayerIds: [] },
  ];
  assert.deepEqual(strengthsForSession(invalid, ids, baseline, date), initialStrengths(ids, baseline));
  assert.deepEqual(strengthsForSession([...invalid, good], ids, baseline, date), strengthsForSession([good], ids, baseline, date));
});

test('14-member weighted scheduling retains game counts, time window and preparation pair', () => {
  const lockedPairs = [['gdr001', 'gdr014']];
  const quotas = allocateForWindow(ids, 4, lockedPairs);
  let seed = 123;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const strengths = strengthsForSession([], ids, baseline, date);
  const result = generateSchedule(ids, quotas, { strengths, lockedPairs, random, attempts: 100 });
  validateSession({ date, participantIds: ids, fixedPlayerIds: ids, startTime: '19:00', roundMinutes: 30, matchMap: result.matchMap, lockedPairs }, ids);
  assert.ok(Math.max(...Object.values(result.matchMap).map(match => match.round)) <= 4);
  for (const match of Object.values(result.matchMap)) if ([...match.teamA, ...match.teamB].includes('gdr001')) assert.ok([match.teamA, match.teamB].some(team => team.includes('gdr001') && team.includes('gdr014')));
});

test('Q3 and Q4 outcomes inform the same half-year; H1, previous year and career sources never contribute', () => {
  const good = record(['gdr013', 'gdr009'], ['gdr006', 'gdr007']);
  const q3 = { ...good, date: '2026-09-27' };
  assert.deepEqual(strengthsForSession([q3], ids, baseline, date), strengthsForSession([good], ids, baseline, date));
  const old = ['2026-06-28', '2025-10-05'].map(date => ({ ...good, date }));
  const career = { id: 'career-2026-06', kind: 'individual-aggregate', contributesToRatings: true, datePrecision: 'month', cutoff: '2026-06', rows: [{ playerId: 'gdr013', stats: { wins: 100, draws: 0, losses: 0 } }] };
  const h1 = { ...career, period: '2026-H1', datePrecision: 'day', cutoff: '2026-06-28' };
  assert.deepEqual(strengthsForSession(old, ids, baseline, date, [career, h1]), initialStrengths(ids, baseline));
  assert.deepEqual(strengthsForSession([good], ids, baseline, date, [career, h1]), strengthsForSession([good], ids, baseline, date));
});
test('half-year snapshots use only verified identities, remove covered actual outcomes and do not leak future results', () => {
  const actual = record(['gdr013', 'gdr009'], ['gdr006', 'gdr007']);
  const snapshot = { id: 'half-2026-H2', kind: 'individual-aggregate', period: '2026-H2', periodStart: '2026-07-01', datePrecision: 'day', cutoff: '2026-10-11', rows: [{ playerId: 'gdr013', stats: { games: 1, wins: 1, draws: 0, losses: 0 }, issues: [] }] };
  const withActual = strengthsForSession([actual], ids, baseline, date);
  assert.deepEqual(strengthsForSession([actual], ids, baseline, date, [snapshot]), withActual);
  const many = { ...snapshot, rows: [{ ...snapshot.rows[0], stats: { games: 40, wins: 40, draws: 0, losses: 0 } }] };
  const priors = initialStrengths(ids, baseline), changed = strengthsForSession([], ids, baseline, date, [many]);
  assert.ok(changed.gdr013 > priors.gdr013 && changed.gdr013 - priors.gdr013 < 0.03);
  const quarterClose = { ...many, period: '2026-Q3', aggregationRole: 'period-baseline', contributesToRatings: true, cutoff: '2026-09-27' };
  assert.deepEqual(strengthsForSession([], ids, baseline, date, [quarterClose]), changed);
  assert.deepEqual(strengthsForSession([], ids, baseline, date, [quarterClose, { ...many, contributesToRatings: false }]), changed);
  assert.deepEqual(strengthsForSession([], ids, baseline, date, [{ ...many, contributesToRatings: false }]), priors);
  for (const bad of [{ ...many, periodStart: '2026-01-01' }, { ...many, periodStart: undefined }, { ...many, cutoff: date }, { ...many, cutoff: '2026-11-08' }, { ...many, period: '2025-H2' }, { ...many, rows: [{ ...many.rows[0], playerId: null }] }, { ...many, rows: [{ ...many.rows[0], issues: ['ambiguous-identity'] }] }]) assert.deepEqual(strengthsForSession([], ids, baseline, date, [bad]), priors);
});
test('dated aggregates stay inside the half-year and covered days never count twice', () => {
  const daily = { id: 'daily-h2', kind: 'daily-individual-aggregate', datePrecision: 'day', cutoff: '2026-09-27', rows: [{ playerId: 'gdr013', name: '서명렬', stats: { wins: 2, draws: 0, losses: 0, scored: 12, conceded: 8 } }] };
  const priors = initialStrengths(ids, baseline), withDaily = strengthsForSession([], ids, baseline, date, [daily]);
  assert.ok(withDaily.gdr013 > priors.gdr013);
  const excluded = [ { ...daily, cutoff: '2026-06-28' }, { ...daily, cutoff: date }, { ...daily, rows: [{ ...daily.rows[0], issues: ['identity-review'] }] } ];
  assert.deepEqual(strengthsForSession([], ids, baseline, date, excluded), priors);
  const snapshot = { id: 'half', kind: 'individual-aggregate', period: '2026-H2', periodStart: '2026-07-01', datePrecision: 'day', cutoff: '2026-10-04', rows: [{ playerId: 'gdr013', stats: { games: 10, wins: 7, draws: 0, losses: 3 } }] };
  assert.deepEqual(strengthsForSession([], ids, baseline, date, [snapshot, daily]), strengthsForSession([], ids, baseline, date, [snapshot]));
  const actual = record(['gdr013', 'gdr009'], ['gdr006', 'gdr007'], 'teamA', { date: daily.cutoff });
  assert.deepEqual(strengthsForSession([actual], ids, baseline, date, [daily]), strengthsForSession([actual], ids, baseline, date));
});

const neutralIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const neutral = { priorGames: 24 };
const neutralMatch = (day, outcome = 'teamA', teamA = ['a', 'b'], teamB = ['c', 'd']) => record(teamA, teamB, outcome, { date: day });
const meeting = (day, members) => ({ date: day, fixedPlayerIds: members, participantIds: members, matchMap: { 'r1-c1': { teamA: members.slice(0, 2), teamB: members.slice(2, 4) } } });
const neutralPeriods = [{ id: '2026-Q4', memberIds: neutralIds }];

test('low relative game volume reduces trust in identical winning records', () => {
  const sparse = Array(4).fill(neutralMatch('2026-10-04'));
  const busyPeers = Array(24).fill(neutralMatch('2026-10-11', 'teamA', ['e', 'f'], ['g', 'h']));
  const alone = strengthsForSession(sparse, neutralIds, neutral, date);
  const relative = strengthsForSession([...sparse, ...busyPeers], neutralIds, neutral, date);
  assert.ok(relative.a > 0.5 && relative.a < alone.a);
  assert.ok(relative.c < 0.5 && relative.c > alone.c);
});

test('recorded attendance changes confidence, never rewards attendance as skill', () => {
  const wins = Array(12).fill(neutralMatch('2026-10-04'));
  const sessions = [meeting('2026-10-04', neutralIds.slice(0, 4)), ...['11', '18', '25'].map(day => meeting(`2026-10-${day}`, neutralIds.slice(4)))];
  const allPresent = sessions.map(session => ({ ...session, fixedPlayerIds: neutralIds, participantIds: neutralIds }));
  const low = strengthsForSession(wins, neutralIds, neutral, date, [], { sessions, periods: neutralPeriods });
  const high = strengthsForSession(wins, neutralIds, neutral, date, [], { sessions: allPresent, periods: neutralPeriods });
  assert.ok(low.a > 0.5 && low.a < high.a);
  assert.ok(low.c < 0.5 && low.c > high.c);
  const draws = wins.map(match => neutralMatch(match.date, 'draw'));
  assert.deepEqual(strengthsForSession(draws, neutralIds, neutral, date, [], { sessions: allPresent, periods: neutralPeriods }), initialStrengths(neutralIds, neutral));
  assert.deepEqual(strengthsForSession([], neutralIds, neutral, date, [], { sessions: allPresent, periods: neutralPeriods }), initialStrengths(neutralIds, neutral));
});

test('current quarter form nudges identical half-year win rates without double-counting samples', () => {
  const results = (goodQuarter) => [
    ...Array(12).fill(neutralMatch('2026-09-27', goodQuarter ? 'teamB' : 'teamA')),
    ...Array(4).fill(neutralMatch('2026-09-27', goodQuarter ? 'teamA' : 'teamB')),
    ...Array(12).fill(neutralMatch('2026-10-04', goodQuarter ? 'teamA' : 'teamB')),
    ...Array(4).fill(neutralMatch('2026-10-04', goodQuarter ? 'teamB' : 'teamA')),
  ];
  const improving = strengthsForSession(results(true), neutralIds, neutral, date);
  const declining = strengthsForSession(results(false), neutralIds, neutral, date);
  assert.ok(improving.a > 0.5 && declining.a < 0.5);
  assert.ok(improving.a - 0.5 < 0.04);
  assert.ok(Math.abs(improving.a + declining.a - 1) < 1e-12);
  const onlyQ3 = results(true).filter(match => match.date.startsWith('2026-09'));
  assert.deepEqual(strengthsForSession(onlyQ3, neutralIds, neutral, date), strengthsForSession(onlyQ3, neutralIds, neutral, '2026-10-01'));
});

test('attendance excludes other half-years, future dates, duplicates and pre-membership meetings', () => {
  const wins = Array(12).fill(neutralMatch('2026-10-04'));
  const base = meeting('2026-10-04', neutralIds.slice(0, 4));
  const context = { sessions: [base], periods: neutralPeriods };
  const expected = strengthsForSession(wins, neutralIds, neutral, date, [], context);
  const excluded = ['2026-06-28', date, '2026-11-08'].map(day => meeting(day, neutralIds.slice(4)));
  excluded.push(meeting('2026-10-18', ['guest001', 'guest002', 'guest003', 'guest004']));
  assert.deepEqual(strengthsForSession(wins, neutralIds, neutral, date, [], { ...context, sessions: [base, base, ...excluded] }), expected);
  const earlier = meeting('2026-10-01', neutralIds.slice(4));
  const lateMembers = [{ ...neutralPeriods[0], startsOn: '2026-10-04' }];
  assert.deepEqual(strengthsForSession(wins, neutralIds, neutral, date, [], { sessions: [earlier, base], periods: lateMembers }), expected);
});

test('unseparable H2 aggregates do not become invented Q4 form or attendance', () => {
  const snapshot = { kind: 'individual-aggregate', period: '2026-H2', periodStart: '2026-07-01', datePrecision: 'day', cutoff: '2026-10-04', rows: [{ playerId: 'a', stats: { games: 24, wins: 24, draws: 0, losses: 0 } }] };
  const expected = strengthsForSession([], neutralIds, neutral, date, [snapshot]);
  assert.deepEqual(expected, strengthsForSession([], neutralIds, neutral, '2026-10-11', [snapshot]));
  assert.ok(expected.a > 0.5 && expected.a - 0.5 <= 0.03);
  const daily = { kind: 'daily-individual-aggregate', contributesToRatings: false, cutoff: '2026-10-11', datePrecision: 'day', rows: [{ playerId: 'a', stats: { wins: 20, draws: 0, losses: 0, scored: 120, conceded: 20 } }] };
  assert.deepEqual(strengthsForSession([], neutralIds, neutral, date, [snapshot, daily]), expected);
});
