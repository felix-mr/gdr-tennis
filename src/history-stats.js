import { validDate, ranking, rankStats } from './model.js';
import { withinPeriod } from './periods.js';

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
