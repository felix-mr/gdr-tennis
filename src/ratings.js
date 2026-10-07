import { quarter, validDate, validResult } from './model.js';
import { GUEST_STRENGTH, validateGuests } from './guests.js';
import { historicalPriors } from './history-stats.js';

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
  const priors = historicalPriors(initialStrengths(ids, baseline), history, date);
  const priorGames = baseline.priorGames ?? 24;
  if (!Number.isFinite(priorGames) || priorGames <= 0) throw new Error('대진 초기 설정을 확인해 주세요.');
  const observations = Object.fromEntries(ids.map(id => [id, { games: 0, residual: 0 }]));
  for (const record of records) {
    if (!validDate(record.date) || record.date >= date || quarter(record.date) !== quarter(date) || !validResult(record)) continue;
    const { teamA, teamB } = record;
    if (!Array.isArray(teamA) || !Array.isArray(teamB) || teamA.length !== 2 || teamB.length !== 2) continue;
    const active = [...teamA, ...teamB];
    try { validateGuests(record.guests || {}); } catch { continue; }
    if (new Set(active).size !== 4 || active.some(id => id in priors ? !record.fixedPlayerIds?.includes(id) : !Object.hasOwn(record.guests || {}, id))) continue;
    const mean = team => team.reduce((sum, id) => sum + (priors[id] ?? GUEST_STRENGTH), 0) / 2;
    const expected = 1 / (1 + Math.exp(-4 * (mean(teamA) - mean(teamB))));
    const actual = record.outcome === 'draw' ? 0.5 : record.outcome === 'teamA' ? 1 : 0;
    for (const id of teamA) if (observations[id]) { observations[id].games++; observations[id].residual += actual - expected; }
    for (const id of teamB) if (observations[id]) { observations[id].games++; observations[id].residual -= actual - expected; }
  }
  return Object.fromEntries(ids.map(id => {
    const { games, residual } = observations[id];
    if (!games) return [id, priors[id]];
    const performance = clamp(priors[id] + residual / games);
    const weight = games ** 2 / (games ** 2 + priorGames ** 2);
    return [id, priors[id] * (1 - weight) + performance * weight];
  }));
}
