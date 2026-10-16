import { quarter, validDate, validResult, isOfficialMeeting } from './model.js';
import { GUEST_STRENGTH, validateGuests } from './guests.js';
import { halfYear, halfYearBounds, quarterBounds, withinPeriod } from './periods.js';
import { datedHistory, historyForOfficialMeetings } from './history-stats.js';

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

// Attendance and relative game volume attenuate confidence, never performance.
// Recent-quarter form nudges half-year form only after enough quarter evidence.
export function strengthsForSession(records, ids, baseline, date, history = [], context = {}) {
  if (!validDate(date)) throw new Error('모임 날짜를 확인해 주세요.');
  history = historyForOfficialMeetings(history, context.sessions || []);
  const priors = initialStrengths(ids, baseline), period = halfYear(date);
  const priorGames = baseline.priorGames ?? 24;
  if (!Number.isFinite(priorGames) || priorGames <= 0) throw new Error('대진 초기 설정을 확인해 주세요.');
  const empty = () => Object.fromEntries(ids.map(id => [id, { games: 0, residual: 0 }]));
  const observations = empty(), recent = empty(), currentQuarter = quarter(date);
  const accepted = [];
  for (const record of records) {
    if (!isOfficialMeeting(record) || !validDate(record.date) || record.date >= date || !withinPeriod(period, record.date) || !validResult(record)) continue;
    const { teamA, teamB } = record;
    if (!Array.isArray(teamA) || !Array.isArray(teamB) || teamA.length !== 2 || teamB.length !== 2) continue;
    const active = [...teamA, ...teamB];
    try { validateGuests(record.guests || {}); } catch { continue; }
    if (new Set(active).size !== 4 || active.some(id => id in priors ? !record.fixedPlayerIds?.includes(id) : !Object.hasOwn(record.guests || {}, id))) continue;
    accepted.push(record);
    const mean = team => team.reduce((sum, id) => sum + (priors[id] ?? GUEST_STRENGTH), 0) / 2;
    const expected = 1 / (1 + Math.exp(-4 * (mean(teamA) - mean(teamB))));
    const actual = record.outcome === 'draw' ? 0.5 : record.outcome === 'teamA' ? 1 : 0;
    for (const [team, residual] of [[teamA, actual - expected], [teamB, expected - actual]]) for (const id of team) if (observations[id]) {
      observations[id].games++; observations[id].residual += residual;
      if (withinPeriod(currentQuarter, record.date)) { recent[id].games++; recent[id].residual += residual; }
    }
  }
  const aggregate = periodEvidence(history, accepted, ids, date, period);
  const recentAggregate = periodEvidence(history, accepted, ids, date, currentQuarter);
  const confidence = participationConfidence(accepted, history, ids, date, period, observations, aggregate, context);
  const recentConfidence = participationConfidence(accepted, history, ids, date, currentQuarter, recent, recentAggregate, context);
  return Object.fromEntries(ids.map(id => {
    const { games, residual } = observations[id];
    const old = aggregate[id];
    const oldWeight = 0.15 * sampleWeight(old.games, priorGames) * confidence[id];
    const anchor = clamp(priors[id] + oldWeight * (old?.games ? (old.wins + old.draws / 2) / old.games - 0.5 : 0) * 0.4);
    const quarterOld = recentAggregate[id], quarterActual = recent[id];
    const recentWeight = 0.25 * sampleWeight(quarterOld.games + quarterActual.games, priorGames / 2) * recentConfidence[id];
    const quarterAnchor = clamp(priors[id] + 0.15 * sampleWeight(quarterOld.games, priorGames) * recentConfidence[id] * (quarterOld.games ? (quarterOld.wins + quarterOld.draws / 2) / quarterOld.games - 0.5 : 0) * 0.4);
    // A quarter without separable aggregate evidence must not erase H2 evidence.
    const adjustedAnchor = quarterOld.games ? anchor + recentWeight * (quarterAnchor - anchor) : anchor;
    if (!games) return [id, adjustedAnchor];
    const form = residual / games;
    const recentForm = quarterActual.games ? form + recentWeight * (quarterActual.residual / quarterActual.games - form) : form;
    const performance = clamp(priors[id] + recentForm);
    const weight = sampleWeight(games, priorGames) * confidence[id];
    return [id, adjustedAnchor * (1 - weight) + performance * weight];
  }));
}

const sampleWeight = (games, priorGames) => games ** 2 / (games ** 2 + priorGames ** 2);

function participationConfidence(actual, history, ids, date, period, observations, aggregate, context) {
  const totals = ids.map(id => observations[id].games + aggregate[id].games);
  const positive = totals.filter(games => games > 0).sort((a, b) => a - b);
  // A robust peer benchmark prevents one unusually busy member dominating.
  const benchmark = positive[Math.ceil(positive.length * 0.75) - 1] || 1;
  const meetings = new Map();
  const add = (day, members) => {
    if (!validDate(day) || day >= date || !withinPeriod(period, day)) return;
    const known = members.filter(id => ids.includes(id));
    if (!known.length) return;
    if (!meetings.has(day)) meetings.set(day, new Set());
    for (const id of known) meetings.get(day).add(id);
  };
  for (const session of context.sessions || []) {
    if (!isOfficialMeeting(session) || !Object.keys(session.matchMap || {}).length) continue;
    add(session.date, session.fixedPlayerIds);
  }
  for (const record of actual) add(record.date, [...record.teamA, ...record.teamB].filter(id => record.fixedPlayerIds.includes(id)));
  for (const row of datedHistory(history.filter(set => set.contributesToRatings !== false), period, actual)) if (!row.review && row.games > 0) add(row.date, [row.playerId]);
  return Object.fromEntries(ids.map((id, index) => {
    const firstSeen = new Map();
    for (const [day, members] of meetings) if (members.has(id)) {
      const q = quarter(day); if (!firstSeen.has(q) || day < firstSeen.get(q)) firstSeen.set(q, day);
    }
    let opportunities = 0, attended = 0;
    for (const [day, members] of meetings) {
      const configured = (context.periods || []).find(entry => entry.id === quarter(day));
      const eligible = configured ? configured.memberIds.includes(id) && day >= (configured.startsOn || quarterBounds(configured.id).start) && day < (configured.endsBefore || quarterBounds(configured.id).endBefore) : firstSeen.has(quarter(day)) && day >= firstSeen.get(quarter(day));
      if (!eligible) continue;
      opportunities++; if (members.has(id)) attended++;
    }
    // Unknown attendance is neutral; four pseudo-attendances damp sparse dates.
    const attendance = opportunities ? (attended + 4) / (opportunities + 4) : 1;
    const volume = Math.min(1, totals[index] / benchmark);
    return [id, (0.5 + 0.5 * volume) * (0.5 + 0.5 * attendance)];
  }));
}

// Only a matching period snapshot can supply results without match details.
// Remove already-observed games from each snapshot before applying a small
// aggregate adjustment. No partner/opponent quality is inferred from these rows.
function periodEvidence(history, actual, ids, date, period) {
  const cutoffLimit = date;
  const output = Object.fromEntries(ids.map(id => [id, { games: 0, wins: 0, draws: 0, losses: 0 }]));
  const start = (period.includes('-H') ? halfYearBounds(period) : quarterBounds(period)).start;
  const snapshot = history.filter(set => set.kind === 'individual-aggregate' && set.contributesToRatings !== false && (set.period === period || set.aggregationRole === 'period-baseline') && set.periodStart === start && set.datePrecision === 'day' && validDate(set.cutoff) && withinPeriod(period, set.cutoff) && set.cutoff < cutoffLimit && set.status !== 'superseded').sort((a, b) => b.cutoff.localeCompare(a.cutoff))[0];
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
  for (const row of datedHistory(history.filter(set => set.contributesToRatings !== false), period, actual)) {
    if (!output[row.playerId] || row.date >= date || row.review || (covered.has(row.playerId) && row.date <= snapshot.cutoff)) continue;
    for (const key of ['games', 'wins', 'draws', 'losses']) output[row.playerId][key] += row[key];
  }
  return output;
}
