import { validDate, ranking, rankStats, quarter } from './model.js';
import { withinPeriod, quarterBounds } from './periods.js';

export function normalizeDailyRows(dataset) {
  if (dataset.kind !== 'daily-individual-aggregate' || dataset.contributesToLiveRanking === false || dataset.status === 'superseded' || dataset.datePrecision !== 'day' || !validDate(dataset.cutoff)) return [];
  return dataset.rows.flatMap(row => {
    const stats = row.stats;
    if (!row.playerId || !stats || !['wins', 'draws', 'losses', 'scored', 'conceded'].every(key => Number.isInteger(stats[key]) && stats[key] >= 0)) return [];
    return [{ playerId: row.playerId, name: row.name, date: dataset.cutoff, sourceId: dataset.id, wins: stats.wins, draws: stats.draws, losses: stats.losses, games: stats.wins + stats.draws + stats.losses, points: 3 * stats.wins + stats.draws, scored: stats.scored, conceded: stats.conceded, difference: stats.scored - stats.conceded, review: !!row.issues?.length || row.identityStatus === 'tentative-user-guidance' }];
  });
}
export function datedHistory(sets, period = 'all', actualRecords = []) {
  const actualDates = new Set(actualRecords.map(record => record.date)), seen = new Set();
  return sets.flatMap(normalizeDailyRows).filter(row => {
    const key = `${row.date}_${row.playerId}`;
    if (actualDates.has(row.date) || !withinPeriod(period, row.date) || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function historicalPlayers(sets, players) {
  const names = new Map(players.map(player => [player.id, player]));
  for (const set of sets) for (const row of set.rows || []) if (row.playerId && !names.has(row.playerId) && row.name && !row.names) names.set(row.playerId, { id: row.playerId, name: row.name, gender: 'male' });
  return [...names.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
export function rankingWithHistory(records, players, period, sets) {
  const rows = new Map(ranking(records.filter(record => withinPeriod(period, record.date)), players).map(row => [row.id, { ...row, historyGames: 0, historyReview: false }]));
  for (const old of datedHistory(sets, period, records)) {
    const row = rows.get(old.playerId); if (!row) continue;
    for (const key of ['games', 'wins', 'draws', 'losses', 'points', 'scored', 'conceded']) row[key] += old[key];
    row.historyGames += old.games; row.historyReview ||= old.review;
  }
  return rankStats([...rows.values()]);
}
// Only pre-quarter career data nudges the manual prior, by at most 1.6 points
// on the internal 0–1 scale. Current-quarter evidence remains separate.
export function historicalPriors(priors, sets, date) {
  const before = quarterBounds(quarter(date)).start;
  const candidates = sets.filter(set => set.kind === 'individual-aggregate' && set.contributesToRatings === true && set.id.startsWith('career-') && validDate(`${set.cutoff}-01`) && `${set.cutoff}-31` < before).sort((a, b) => b.cutoff.localeCompare(a.cutoff));
  const result = { ...priors }, seen = new Set();
  for (const set of candidates) for (const row of set.rows) {
    if (!Object.hasOwn(priors, row.playerId) || seen.has(row.playerId)) continue;
    const stats = row.stats;
    if (!['wins', 'draws', 'losses'].every(key => Number.isInteger(stats?.[key]) && stats[key] >= 0)) continue;
    const games = stats.wins + stats.draws + stats.losses; if (!games) continue;
    seen.add(row.playerId);
    const weight = 0.08 * games / (games + 40), change = (stats.wins / games - 0.5) * 0.4;
    const target = Math.max(0, Math.min(1, priors[row.playerId] + change));
    result[row.playerId] = priors[row.playerId] * (1 - weight) + target * weight;
  }
  return result;
}
