import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultScheduleDate, scheduleDates, renderRounds } from '../src/schedule-display.js';

const session = { date: '2026-10-11', startTime: '19:00', endTime: '20:00', roundMinutes: 30, participantIds: ['a', 'b', 'c', 'd', 'e'], lockedPairs: [['a', 'b']], matchMap: { m1: { round: 1, court: 2, teamA: ['a', 'b'], teamB: ['c', 'd'] }, m2: { round: 2, court: 1, teamA: ['a', 'e'], teamB: ['c', 'd'] } } };
const names = { a: '<a>', b: 'B', c: 'C', d: 'D', e: 'E' };
const state = { sessions: { [session.date]: session }, results: { [`${session.date}_m1`]: { scoreA: 6, scoreB: 4, outcome: 'teamA' } } };
test('member default uses upcoming confirmed meeting, otherwise pending next meeting; past selection stays accessible', () => {
  assert.equal(defaultScheduleDate({}, '2026-10-09'), '2026-10-11');
  assert.equal(defaultScheduleDate({ '2026-10-04': {} }, '2026-10-09'), '2026-10-11');
  assert.equal(defaultScheduleDate({ '2026-10-04': {}, '2026-10-18': {}, '2026-10-11': {} }, '2026-10-09'), '2026-10-11');
  assert.equal(defaultScheduleDate({ '2026-10-04': {}, '2026-10-11': {} }, '2026-10-09', '2026-10-04'), '2026-10-04');
});
test('pending next meeting remains selectable after choosing a past schedule', () => {
  const sessions = { '2026-10-04': {} };
  assert.equal(defaultScheduleDate(sessions, '2026-10-09', '2026-10-04'), '2026-10-04');
  assert.deepEqual(scheduleDates(sessions, '2026-10-09'), ['2026-10-11', '2026-10-04']);
  assert.deepEqual(scheduleDates({}, '2026-10-09'), ['2026-10-11']);
  assert.deepEqual(scheduleDates({ ...sessions, '2026-10-11': {} }, '2026-10-09'), ['2026-10-11', '2026-10-04']);
});
test('member display is read-only, escapes names and shows fixed pair, saved score and correct idle court', () => {
  const html = renderRounds({ session, state, names });
  assert.ok(!html.includes('<form') && !html.includes('<input') && !html.includes('<button'));
  assert.ok(html.includes('&lt;a&gt;') && html.includes('고정 페어') && html.includes('<strong>6</strong>'));
  assert.ok(html.includes('안쪽 코트 · 휴식'));
  assert.equal((renderRounds({ session, state, names, editable: true, writable: true }).match(/class="score-form"/g) || []).length, 2);
});
test('finding one member keeps their rest round visible and excludes unrelated matches', () => {
  const html = renderRounds({ session, state, names, focusPlayer: 'e' });
  assert.ok(html.includes('E · 이번 라운드 휴식'));
  assert.equal((html.match(/class="match"/g) || []).length, 1);
});
test('score forms retain their own date and distinct labels across member and organizer tabs', () => {
  const viewer = renderRounds({ session, state, names, editable: true, writable: true, controlPrefix: 'viewer' });
  const manager = renderRounds({ session, state, names, editable: true, writable: true });
  assert.ok(viewer.includes('data-date="2026-10-11"'));
  assert.ok(viewer.includes('for="viewer-m1-a"') && viewer.includes('id="viewer-m1-a"'));
  assert.ok(manager.includes('id="manage-m1-a"') && !manager.includes('id="viewer-m1-a"'));
  assert.ok(renderRounds({ session, state, names, editable: true }).includes('class="text-button" disabled'));
});
