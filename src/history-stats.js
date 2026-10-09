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
// A confirmed period total replaces records inside its coverage window.
// It is never treated as a single day's results or split into smaller periods.
export function baselineHistory(sets, period = 'all') {
  const covered = new Map();
  return sets.filter(set => set.kind === 'individual-aggregate' && set.aggregationRole === 'period-baseline' && set.contributesToLiveRanking === true && set.status !== 'superseded' && set.datePrecision === 'day' && validDate(set.periodStart) && validDate(set.cutoff) && set.periodStart <= set.cutoff && withinPeriod(period, set.periodStart) && withinPeriod(period, set.cutoff)).sort((a, b) => b.cutoff.localeCompare(a.cutoff)).flatMap(set => (set.rows || []).flatMap(row => {
    if (!row.playerId || ['identity-unconfirmed', 'quarantine'].includes(row.status) || row.identityStatus === 'tentative-user-guidance') return [];
    const stats = row.stats;
    if (!['wins', 'draws', 'losses', 'scored', 'conceded'].every(key => Number.isInteger(stats?.[key]) && stats[key] >= 0)) return [];
    const ranges = covered.get(row.playerId) || [];
    if (ranges.some(range => set.periodStart <= range.end && set.cutoff >= range.start)) return [];
    ranges.push({ start: set.periodStart, end: set.cutoff }); covered.set(row.playerId, ranges);
    return [{ playerId: row.playerId, name: row.name, date: set.cutoff, coverageStart: set.periodStart, sourceId: set.id, games: stats.wins + stats.draws + stats.losses, wins: stats.wins, draws: stats.draws, losses: stats.losses, points: 3 * stats.wins + stats.draws, scored: stats.scored, conceded: stats.conceded, difference: stats.scored - stats.conceded, review: !!row.issues?.length }];
  }));
}
export function historicalPlayers(sets, players) {
  const names = new Map(players.map(player => [player.id, player]));
  for (const set of sets) for (const row of set.rows || []) if (row.playerId && !names.has(row.playerId) && row.name && !row.names) names.set(row.playerId, { id: row.playerId, name: row.name, gender: 'male' });
  return [...names.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
}
export function rankingWithHistory(records, players, period, sets) {
  const baselines = baselineHistory(sets, period);
  const covered = (id, date) => baselines.some(row => row.playerId === id && date >= row.coverageStart && date <= row.date);
  const actual = records.filter(record => withinPeriod(period, record.date)).map(record => ({ ...record, fixedPlayerIds: record.fixedPlayerIds.filter(id => !covered(id, record.date)) }));
  const rows = new Map(ranking(actual, players).map(row => [row.id, { ...row, historyGames: 0, baselineGames: 0, historyReview: false }]));
  const dated = datedHistory(sets, period, records).filter(row => !covered(row.playerId, row.date));
  for (const old of [...baselines, ...dated]) {
    const row = rows.get(old.playerId); if (!row) continue;
    for (const key of ['games', 'wins', 'draws', 'losses', 'points', 'scored', 'conceded']) row[key] += old[key];
    row.historyGames += old.games; row.historyReview ||= old.review;
    if (old.coverageStart) row.baselineGames += old.games;
  }
  return rankStats([...rows.values()]);
}
