import test from 'node:test';
import assert from 'node:assert/strict';
import { initialStrengths, strengthsForSession } from '../src/ratings.js';
import { generateSchedule, allocateForWindow } from '../src/scheduler.js';
import { validateSession } from '../src/model.js';
import baseline from '../data/strength-baseline.json' with { type: 'json' };
import players from '../data/players.json' with { type: 'json' };
const ids = players.map(p => p.id), date = '2026-11-01';
const record = (teamA, teamB, outcome = 'teamA', overrides = {}) => ({ date: '2026-10-11', teamA, teamB, scoreA: outcome === 'teamB' ? 4 : 6, scoreB: outcome === 'teamA' ? 4 : 6, outcome, fixedPlayerIds: [...teamA, ...teamB], ...overrides });

test('all 14 supplied members follow seven equal-value groups; no data keeps initial values', () => {
  const values = initialStrengths(ids, baseline);
  assert.equal(Object.keys(values).length, 14);
  for (let i = 0; i < baseline.groups.length; i++) {
    const [a, b] = baseline.groups[i];
    assert.equal(values[a], values[b]);
    if (i) assert.ok(values[a] < values[baseline.groups[i - 1][0]]);
  }
  assert.deepEqual(strengthsForSession([], ids, baseline, date), values);
  const reversed = initialStrengths(ids, { ...baseline, groups: [...baseline.groups].reverse() });
  assert.ok(reversed.gdr011 > reversed.gdr001);
});

test('one unexpected result stays close to prior; sustained outcomes can change original order', () => {
  const upset = record(['gdr011', 'gdr010'], ['gdr001', 'gdr002']);
  const priors = initialStrengths(ids, baseline);
  const one = strengthsForSession([upset], ids, baseline, date);
  assert.ok(one.gdr011 > priors.gdr011 && one.gdr011 - priors.gdr011 < 0.07);
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
});

test('a win against higher rated teams provides more evidence than an expected win', () => {
  const strong = record(['gdr013', 'gdr009'], ['gdr001', 'gdr002']);
  const weak = record(['gdr013', 'gdr009'], ['gdr011', 'gdr010']);
  assert.ok(strengthsForSession([strong], ids, baseline, date).gdr013 > strengthsForSession([weak], ids, baseline, date).gdr013);
});

test('exclude other quarters, same/future date, invalid score, duplicate player and unknown IDs', () => {
  const good = record(['gdr001', 'gdr002'], ['gdr011', 'gdr010']);
  const invalid = [
    { ...good, date: '2026-09-27' }, { ...good, date }, { ...good, date: '2026-11-08' },
    { ...good, scoreA: -1 }, { ...good, outcome: 'draw' },
    { ...good, teamB: ['gdr001', 'gdr010'] }, { ...good, teamA: ['unknown', 'gdr002'] },
    { ...good, fixedPlayerIds: [] },
  ];
  assert.deepEqual(strengthsForSession(invalid, ids, baseline, date), initialStrengths(ids, baseline));
  assert.deepEqual(strengthsForSession([...invalid, good], ids, baseline, date), strengthsForSession([good], ids, baseline, date));
});

test('14-member weighted scheduling retains game counts, time window and preparation pair', () => {
  const lockedPairs = [['gdr001', 'gdr014']];
  const quotas = allocateForWindow(ids, 4, {}, lockedPairs);
  let seed = 123;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const strengths = strengthsForSession([], ids, baseline, date);
  const result = generateSchedule(ids, quotas, { strengths, lockedPairs, random, attempts: 100 });
  validateSession({ date, participantIds: ids, fixedPlayerIds: ids, startTime: '19:00', roundMinutes: 30, matchMap: result.matchMap, lockedPairs }, ids);
  assert.ok(Math.max(...Object.values(result.matchMap).map(match => match.round)) <= 4);
  for (const match of Object.values(result.matchMap)) if ([...match.teamA, ...match.teamB].includes('gdr001')) assert.ok([match.teamA, match.teamB].some(team => team.includes('gdr001') && team.includes('gdr014')));
});
