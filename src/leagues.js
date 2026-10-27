import { initialStrengths, eligibleRatingRecords } from './ratings.js';
import { isOfficialMeeting, validDate } from './model.js';
import { halfYear, withinPeriod } from './periods.js';

export const LEAGUE_WINDOW_GAMES = 12;
export const LEAGUE_WINDOW_MEETINGS = 6;
export const LEAGUE_MIN_MEETINGS = 3;
export const PROMOTION_RATE = 0.65;
export const DEMOTION_RATE = 0.35;

// Internal only. Replaying dated results makes redraws and different devices
// agree without publishing member labels or inventing dates for old totals.
export function leaguesForSession(records, ids, baseline, date, context = {}) {
  if (!validDate(date)) throw new Error('모임 날짜를 확인해 주세요.');
  const strengths = initialStrengths(ids, baseline);
  const configured = (baseline.groups || []).flat().filter(id => ids.includes(id));
  const ordered = (configured.length ? configured : ids).map(id => strengths[id]).sort((a, b) => b - a);
  let boundary = 0.5;
  if (ordered.length >= 8) {
    const cuts = Array.from({ length: ordered.length - 7 }, (_, i) => i + 4).filter(i => ordered[i - 1] > ordered[i]);
    const cut = cuts.sort((a, b) => Math.abs(a - ordered.length / 2) - Math.abs(b - ordered.length / 2) || b - a)[0];
    if (cut !== undefined) boundary = (ordered[cut - 1] + ordered[cut]) / 2;
  }
  const leagues = Object.fromEntries(ids.map(id => [id, strengths[id] >= boundary ? 0 : 1]));
  const evidence = Object.fromEntries(ids.map(id => [id, []])), changes = [];
  const accepted = eligibleRatingRecords(records, ids, date);
  const meetings = new Map();
  for (const record of accepted) {
    if (!meetings.has(record.date)) meetings.set(record.date, []);
    meetings.get(record.date).push(record);
  }
  for (const session of context.sessions || []) if (isOfficialMeeting(session) && validDate(session.date) && session.date < date && withinPeriod(halfYear(date), session.date) && Object.keys(session.matchMap || {}).length && !meetings.has(session.date)) meetings.set(session.date, []);
  const days = [...meetings.keys()].sort();
  for (const [index, day] of days.entries()) {
    const oldest = days[Math.max(0, index - LEAGUE_WINDOW_MEETINGS + 1)];
    // Sorting match slots keeps replay independent of snapshot insertion order.
    const matches = meetings.get(day).slice().sort((a, b) => (a.round || 0) - (b.round || 0) || (a.court || 0) - (b.court || 0) || [...a.teamA, ...a.teamB].join('|').localeCompare([...b.teamA, ...b.teamB].join('|')));
    for (const match of matches) {
      const mean = team => team.reduce((sum, id) => sum + (strengths[id] ?? 0.65), 0) / 2;
      const expected = 1 / (1 + Math.exp(-4 * (mean(match.teamA) - mean(match.teamB))));
      const result = match.outcome === 'draw' ? 0.5 : match.outcome === 'teamA' ? 1 : 0;
      for (const [team, actual, prediction] of [[match.teamA, result, expected], [match.teamB, 1 - result, 1 - expected]]) for (const id of team) if (evidence[id]) evidence[id].push({ date: day, actual, residual: actual - prediction });
    }
    for (const id of ids) {
      evidence[id] = evidence[id].filter(item => item.date >= oldest).slice(-LEAGUE_WINDOW_GAMES);
      const window = evidence[id];
      if (window.length < LEAGUE_WINDOW_GAMES || new Set(window.map(item => item.date)).size < LEAGUE_MIN_MEETINGS) continue;
      const rate = window.filter(item => item.actual === 1).length / window.length;
      const residual = window.reduce((sum, item) => sum + item.residual, 0) / window.length;
      const next = leagues[id] === 1 && rate >= PROMOTION_RATE && residual >= 0.05 ? 0 : leagues[id] === 0 && rate <= DEMOTION_RATE && residual <= -0.05 ? 1 : leagues[id];
      if (next !== leagues[id]) {
        changes.push({ id, date: day, from: leagues[id], to: next }); leagues[id] = next;
        // A new group needs its own fresh sample before another move.
        evidence[id] = [];
      }
    }
  }
  return { leagues, changes, boundary };
}
