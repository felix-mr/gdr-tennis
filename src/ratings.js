import { validDate, validResult } from './model.js';
import { GUEST_STRENGTH, validateGuests } from './guests.js';
import { halfYear, withinPeriod } from './periods.js';
import { datedHistory } from './history-stats.js';

const clamp = value => Math.max(0, Math.min(1, value));

export function initialStrengths(ids, baseline = {}) {
  const groups = baseline.groups || [];
  const grouped = groups.flat();
  if (!Array.isArray(groups) || groups.some(group => !Array.isArray(group) || !group.length || group.some(id => !ids.includes(id))) || new Set(grouped).size !== grouped.length) throw new Error('대진 초기 설정을 확인해 주세요.');
  const priors = Object.fromEntries(ids.map(id => {
    const value = baseline.ratings?.[id];
    return [id, Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0.5];
  }));
  groups.forEach((group, index) => group.forEach(id => {
    priors[id] = groups.length === 1 ? 0.5 : 0.9 - 0.8 * index / (groups.length - 1);
  }));
  return priors;
}

// Shrink opponent-adjusted results toward the supplied prior. Attendance affects
// confidence, not a player's performance score. A quadratic ramp keeps the
// supplied prior dominant early, with equal weights after 24 recorded games.
export function strengthsForSession(records, ids, baseline, date, history = []) {
  if (!validDate(date)) throw new Error('모임 날짜를 확인해 주세요.');
  const priors = initialStrengths(ids, baseline), period = halfYear(date);
  const priorGames = baseline.priorGames ?? 24;
  if (!Number.isFinite(priorGames) || priorGames <= 0) throw new Error('대진 초기 설정을 확인해 주세요.');
  const observations = Object.fromEntries(ids.map(id => [id, { games: 0, residual: 0 }]));
  const accepted = [];
  for (const record of records) {
    if (!validDate(record.date) || record.date >= date || !withinPeriod(period, record.date) || !validResult(record)) continue;
    const { teamA, teamB } = record;
    if (!Array.isArray(teamA) || !Array.isArray(teamB) || teamA.length !== 2 || teamB.length !== 2) continue;
    const active = [...teamA, ...teamB];
    try { validateGuests(record.guests || {}); } catch { continue; }
    if (new Set(active).size !== 4 || active.some(id => id in priors ? !record.fixedPlayerIds?.includes(id) : !Object.hasOwn(record.guests || {}, id))) continue;
    accepted.push(record);
    const mean = team => team.reduce((sum, id) => sum + (priors[id] ?? GUEST_STRENGTH), 0) / 2;
    const expected = 1 / (1 + Math.exp(-4 * (mean(teamA) - mean(teamB))));
    const actual = record.outcome === 'draw' ? 0.5 : record.outcome === 'teamA' ? 1 : 0;
    for (const id of teamA) if (observations[id]) { observations[id].games++; observations[id].residual += actual - expected; }
    for (const id of teamB) if (observations[id]) { observations[id].games++; observations[id].residual -= actual - expected; }
  }
  const aggregate = halfYearEvidence(history, accepted, ids, date);
  return Object.fromEntries(ids.map(id => {
    const { games, residual } = observations[id];
    const old = aggregate[id];
    const oldWeight = old?.games ? 0.15 * old.games ** 2 / (old.games ** 2 + priorGames ** 2) : 0;
    const anchor = clamp(priors[id] + oldWeight * (old?.games ? (old.wins + old.draws / 2) / old.games - 0.5 : 0) * 0.4);
    if (!games) return [id, anchor];
    const performance = clamp(priors[id] + residual / games);
    const weight = games ** 2 / (games ** 2 + priorGames ** 2);
    return [id, anchor * (1 - weight) + performance * weight];
  }));
}

// Only a matching half-year snapshot can supply results without match details.
// Remove already-observed games from each snapshot before applying a small
// aggregate adjustment. No partner/opponent quality is inferred from these rows.
function halfYearEvidence(history, actual, ids, date) {
  const period = halfYear(date), cutoffLimit = date;
  const output = Object.fromEntries(ids.map(id => [id, { games: 0, wins: 0, draws: 0, losses: 0 }]));
  const start = `${date.slice(0, 4)}-${period.endsWith('H1') ? '01' : '07'}-01`;
  const snapshot = history.filter(set => set.kind === 'individual-aggregate' && set.period === period && set.periodStart === start && set.datePrecision === 'day' && validDate(set.cutoff) && withinPeriod(period, set.cutoff) && set.cutoff < cutoffLimit && set.status !== 'superseded').sort((a, b) => b.cutoff.localeCompare(a.cutoff))[0];
  const covered = new Set();
  if (snapshot) for (const row of snapshot.rows || []) {
    if (!ids.includes(row.playerId) || row.issues?.length || ['quarantine', 'identity-unconfirmed'].includes(row.status) || row.identityStatus === 'tentative-user-guidance') continue;
    const stats = row.stats;
    if (!['wins', 'draws', 'losses'].every(key => Number.isInteger(stats?.[key]) && stats[key] >= 0)) continue;
    const values = { wins: stats.wins, draws: stats.draws, losses: stats.losses };
    if (stats.games !== undefined && stats.games !== values.wins + values.draws + values.losses) continue;
    const observed = actual.filter(record => record.date <= snapshot.cutoff && record.fixedPlayerIds.includes(row.playerId) && [...record.teamA, ...record.teamB].includes(row.playerId));
    for (const record of observed) {
      const side = record.teamA.includes(row.playerId) ? 'teamA' : 'teamB';
      values[record.outcome === 'draw' ? 'draws' : record.outcome === side ? 'wins' : 'losses']--;
    }
    if (Object.values(values).some(value => value < 0)) continue;
    output[row.playerId] = { ...values, games: values.wins + values.draws + values.losses };
    covered.add(row.playerId);
  }
  for (const row of datedHistory(history, period, actual)) {
    if (!output[row.playerId] || row.date >= date || row.review || (covered.has(row.playerId) && row.date <= snapshot.cutoff)) continue;
    for (const key of ['games', 'wins', 'draws', 'losses']) output[row.playerId][key] += row[key];
  }
  return output;
}
