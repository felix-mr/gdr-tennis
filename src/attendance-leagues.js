import { initialStrengths, eligibleRatingRecords, participationConfidence } from './ratings.js';
import { leaguesForSession } from './leagues.js';
import { historyForOfficialMeetings, historicalPlayers, rankingWithHistory } from './history-stats.js';
import { withinPeriod } from './periods.js';
import { quarter, validDate } from './model.js';
import { GUEST_STRENGTH, validateGuests } from './guests.js';

export const PERSONAL_SEED_WEIGHT = 0.5;
export const PERFORMANCE_SEED_WEIGHT = 0.5;
const clamp = value => Math.max(0, Math.min(1, value));

// Global evidence supplies the seed; only today's attendees determine the cut.
export function attendanceLeaguesForSession(records, players, baseline, date, { participantIds = players.map(player => player.id), history = [], sessions = [], periods = [], guests = {} } = {}) {
  if (!validDate(date)) throw new Error('모임 날짜를 확인해 주세요.');
  validateGuests(guests);
  const ids = players.map(player => player.id), priors = initialStrengths(ids, baseline), period = quarter(date);
  if (new Set(participantIds).size !== participantIds.length || participantIds.some(id => !ids.includes(id) && !Object.hasOwn(guests, id))) throw new Error('참석 멤버 명단을 확인해 주세요.');
  const actual = eligibleRatingRecords(records, ids, date).filter(match => withinPeriod(period, match.date));
  const safeHistory = historyForOfficialMeetings(history, sessions).filter(set => set.contributesToRatings !== false && set.datePrecision === 'day' && validDate(set.cutoff) && set.cutoff < date && withinPeriod(period, set.cutoff)).map(set => ({ ...set, rows: (set.rows || []).filter(row => !row.issues?.length && !['identity-unconfirmed', 'quarantine'].includes(row.status) && row.identityStatus !== 'tentative-user-guidance') }));
  // Cross-quarter totals cannot supply quarterly results or volume. The shared
  // ranking helper admits only aggregates covered entirely by this quarter.
  const rows = rankingWithHistory(actual, historicalPlayers(safeHistory, players), period, safeHistory);
  const byId = new Map(rows.map(row => [row.id, row]));
  const observations = Object.fromEntries(ids.map(id => [id, { games: 0 }]));
  for (const match of actual) for (const id of [...match.teamA, ...match.teamB]) if (observations[id]) observations[id].games++;
  const aggregate = Object.fromEntries(ids.map(id => [id, { games: Math.max(0, (byId.get(id)?.games || 0) - observations[id].games) }]));
  const quarterSessions = sessions.filter(session => validDate(session.date) && withinPeriod(period, session.date));
  const confidence = participationConfidence(actual, safeHistory, ids, date, period, observations, aggregate, { sessions: quarterSessions, periods });
  const form = leaguesForSession(actual, ids, baseline, date, { sessions: quarterSessions });
  const seedScores = Object.fromEntries(ids.map(id => {
    const row = byId.get(id);
    const games = row?.games || 0;
    const sample = games ** 2 / (games ** 2 + 24 ** 2);
    const reliability = sample * confidence[id];
    let performance = 0.5;
    if (row?.games) {
      // Use the same wins / all games rate shown in records. More attendance
      // raises confidence in the rate, never the performance score itself.
      const winRate = row.wins / row.games;
      performance += reliability * (winRate - 0.5);
    }
    // A verified form change adjusts performance, not the personal component.
    // It does not reserve a permanent seat in today's A.
    const initial = priors[id] >= form.boundary ? 0 : 1;
    performance = clamp(performance + reliability * 0.2 * (initial - form.leagues[id]));
    return [id, PERSONAL_SEED_WEIGHT * priors[id] + PERFORMANCE_SEED_WEIGHT * performance];
  }));
  for (const id of participantIds) if (Object.hasOwn(guests, id)) seedScores[id] = GUEST_STRENGTH;
  const names = Object.fromEntries(players.map(player => [player.id, player.name || player.id]));
  const order = [...participantIds].sort((a, b) => seedScores[b] - seedScores[a] || (priors[b] ?? GUEST_STRENGTH) - (priors[a] ?? GUEST_STRENGTH) || (names[a] || guests[a]?.name || a).localeCompare(names[b] || guests[b]?.name || b, 'ko') || a.localeCompare(b));
  let cut = order.length;
  if (order.length >= 8) {
    const cuts = Array.from({ length: order.length - 7 }, (_, index) => index + 4);
    const distinct = cuts.filter(index => seedScores[order[index - 1]] - seedScores[order[index]] > 1e-9);
    const gap = index => seedScores[order[index - 1]] - seedScores[order[index]];
    cut = (distinct.length ? distinct : cuts).sort((a, b) => Math.abs(a - order.length / 2) - Math.abs(b - order.length / 2) || gap(b) - gap(a) || b - a)[0];
  }
  const leagues = Object.fromEntries(order.map((id, index) => [id, index < cut ? 0 : 1]));
  return { leagues, seedScores, order, cut, period, changes: form.changes };
}
