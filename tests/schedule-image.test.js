import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleImagePages } from '../src/schedule-image.js';

const ids = ['a', 'b', 'c', 'd'];
const names = { a: '김민종', b: '여상재', c: '김동주', d: '김웅기', e: '최지원' };
const session = rounds => ({ date: '2026-10-11', participantIds: ids, startTime: '19:00', roundMinutes: 30, matchMap: Object.fromEntries(Array.from({ length: rounds }, (_, i) => [`r${i + 1}-c1`, { round: i + 1, court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'] }])) });

test('image pagination preserves every match and ordered rounds, including the largest supported window', () => {
  const source = { ...session(47), startTime: '00:00', endTime: '23:30' };
  // Reverse insertion order to exercise sorting rather than source order.
  source.matchMap = Object.fromEntries(Object.entries(source.matchMap).reverse());
  const pages = scheduleImagePages(source, names, {}, true);
  assert.equal(pages.length, 6);
  assert.ok(pages.every(page => page.rounds.length <= 8));
  assert.deepEqual(pages.flatMap(page => page.rounds.map(round => round.number)), Array.from({ length: 47 }, (_, i) => i + 1));
  assert.equal(new Set(pages.flatMap(page => page.rounds.flatMap(round => round.matches.map(match => match.id)))).size, 47);
  assert.equal(pages.at(-1).rounds.at(-1).end, '23:30');
  assert.equal(new Set(pages.map(page => page.filename)).size, 6);
});

test('image includes correct rest members, evening times and complete per-person game counts', () => {
  const source = { ...session(4), participantIds: [...ids, 'e'] };
  source.matchMap['r2-c1'].teamA = ['a', 'e']; source.matchMap['r4-c1'].teamA = ['a', 'e'];
  const [page] = scheduleImagePages(source, names);
  assert.equal(page.start, '19:00'); assert.equal(page.end, '21:00');
  assert.equal(page.rounds[0].start, '19:00'); assert.equal(page.rounds[0].end, '19:30');
  assert.deepEqual(page.rounds[0].rests, ['최지원']);
  assert.equal(page.members.find(member => member.id === 'a').games, 4);
  assert.equal(page.members.find(member => member.id === 'e').games, 2);
  assert.equal(page.filename, 'GDR-2026-10-11.png');
});

test('only valid saved scores appear; draft and unscored games remain distinct from a saved zero draw', () => {
  const results = { '2026-10-11_r1-c1': { scoreA: 0, scoreB: 0, outcome: 'draw' }, '2026-10-11_r2-c1': { scoreA: 6, scoreB: 4, outcome: 'draw' } };
  assert.equal(scheduleImagePages(session(2), names, results, false)[0].rounds[0].matches[0].score, null);
  const [saved] = scheduleImagePages(session(2), names, results, true);
  assert.deepEqual(saved.rounds[0].matches[0].score, [0, 0]);
  assert.equal(saved.rounds[1].matches[0].score, null);
});

test('export snapshot contains no internal rating or pairing assessment fields', () => {
  const source = { ...session(2), strengths: { a: 0.9 }, balance: { averageGap: 0.1 }, lockedPairs: [['a', 'b']] };
  const output = JSON.stringify(scheduleImagePages(source, names));
  for (const key of ['strengths', 'balance', 'averageGap', 'lockedPairs']) assert.equal(output.includes(key), false);
});
