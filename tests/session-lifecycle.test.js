import test from 'node:test';
import assert from 'node:assert/strict';
import { cancellationText, discardSession, generationOf, resultFor } from '../src/session-lifecycle.js';
import { recordsFrom } from '../src/model.js';
import { scheduleImagePages } from '../src/schedule-image.js';

const generation = 'a'.repeat(32), nextGeneration = 'b'.repeat(32);
const session = { date: '2026-10-11', generation, startTime: '19:00', endTime: '19:30', roundMinutes: 30, participantIds: ['a', 'b', 'c', 'd'], fixedPlayerIds: ['a', 'b', 'c', 'd'], matchMap: { 'r1-c1': { round: 1, court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'] } } };
const result = { generation, scoreA: 6, scoreB: 4, outcome: 'teamA', revision: 1 };
const fixture = () => ({ sessions: { [session.date]: structuredClone(session), '2026-10-18': { ...structuredClone(session), date: '2026-10-18' } }, results: { '2026-10-11_r1-c1': { ...result }, '2026-10-18_r1-c1': { ...result } } });

test('cancellation requires exact dated phrase and current generation; rejected input cannot mutate records', () => {
  for (const [expected, text] of [[generation, '대진 취소'], [generation, '2026-10-11 대진 취소 '], [generation, cancellationText('2026-10-18')], [nextGeneration, cancellationText(session.date)]]) {
    const state = fixture(), original = structuredClone(state);
    assert.throws(() => discardSession(state, session.date, expected, text));
    assert.deepEqual(state, original);
  }
});
test('confirmed cancellation removes target schedule and all its scores; other dates remain', () => {
  const state = fixture();
  discardSession(state, session.date, generation, cancellationText(session.date));
  assert.equal(state.sessions[session.date], undefined);
  assert.equal(state.results['2026-10-11_r1-c1'], undefined);
  assert.equal(recordsFrom(state).length, 1);
  assert.throws(() => discardSession(state, session.date, generation, cancellationText(session.date)));
  assert.ok(state.sessions['2026-10-18']);
});
test('recreated same-date schedule excludes stale scores from records and shared image', () => {
  const state = fixture(); state.sessions[session.date].generation = nextGeneration;
  const recreated = state.sessions[session.date];
  assert.equal(resultFor(state, recreated, 'r1-c1'), undefined);
  assert.equal(recordsFrom(state).filter(row => row.date === session.date).length, 0);
  const names = { a: '김민종', b: '여상재', c: '김동주', d: '심진우' };
  assert.equal(scheduleImagePages(recreated, names, state.results, true)[0].rounds[0].matches[0].score, null);
  state.results['2026-10-11_r1-c1'] = { ...result, generation: nextGeneration };
  assert.equal(recordsFrom(state).filter(row => row.date === session.date).length, 1);
  assert.deepEqual(scheduleImagePages(recreated, names, state.results, true)[0].rounds[0].matches[0].score, [6, 4]);
  assert.equal(generationOf({}), 'legacy');
});
