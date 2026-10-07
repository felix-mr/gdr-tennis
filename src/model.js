import { validateGuests } from './guests.js';
import { resultFor } from './session-lifecycle.js';

export function koreaToday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
}
export function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
}
export const outcome = (a, b) => a > b ? 'teamA' : a < b ? 'teamB' : 'draw';
export const MAX_ROUNDS = 47;
export function meetingWindow(startTime, endTime) {
  const validTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):(00|30)$/.test(value);
  if (!validTime(startTime) || !validTime(endTime)) throw new Error('시작·종료 시간을 30분 단위로 선택해 주세요.');
  const minutes = value => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; };
  const duration = minutes(endTime) - minutes(startTime);
  if (duration <= 0) throw new Error('종료 시간을 시작 시간보다 뒤로 선택해 주세요.');
  return duration / 30;
}
export const validScore = value => Number.isInteger(value) && value >= 0 && value <= 99;
export function validResult(result) { return result && validScore(result.scoreA) && validScore(result.scoreB) && result.outcome === outcome(result.scoreA, result.scoreB); }
export function quarter(date) { return `${date.slice(0, 4)}-Q${Math.ceil(Number(date.slice(5, 7)) / 3)}`; }
export function recordsFrom(state) {
  return Object.values(state.sessions).flatMap(session => Object.entries(session.matchMap).flatMap(([id, match]) => {
    const result = resultFor(state, session, id);
    return validResult(result) ? [{ ...match, ...result, date: session.date, fixedPlayerIds: session.fixedPlayerIds, guests: session.guests || {} }] : [];
  }));
}
export function ranking(records, players) {
  const rows = new Map(players.map(p => [p.id, { ...p, games: 0, wins: 0, draws: 0, losses: 0, points: 0, scored: 0, conceded: 0 }]));
  for (const r of records) {
    if (!validResult(r)) continue;
    for (const side of ['teamA', 'teamB']) for (const id of r[side]) {
      const row = rows.get(id);
      if (!row || !r.fixedPlayerIds.includes(id)) continue;
      row.games++;
      row.scored += side === 'teamA' ? r.scoreA : r.scoreB;
      row.conceded += side === 'teamA' ? r.scoreB : r.scoreA;
      if (r.outcome === 'draw') { row.draws++; row.points++; }
      else if (r.outcome === side) { row.wins++; row.points += 3; }
      else row.losses++;
    }
  }
  return rankStats([...rows.values()]);
}
export function rankStats(rows) {
  const sorted = [...rows].sort((a, b) => b.points - a.points || Number(b.games > 0) - Number(a.games > 0) || (b.scored - b.conceded) - (a.scored - a.conceded) || a.name.localeCompare(b.name, 'ko'));
  let previous = null, rank = null;
  return sorted.map((r, i) => {
    if (r.games && r.points !== previous) rank = i + 1;
    if (r.games) previous = r.points;
    return { ...r, rank: r.games ? rank : null, difference: r.scored - r.conceded, winRate: r.games ? Math.round(100 * r.wins / r.games) : null };
  });
}
export function validateSession(s, knownIds) {
  if (s?.generation !== undefined && (typeof s.generation !== 'string' || !/^[a-f0-9]{32}$/.test(s.generation))) throw new Error('대진 버전을 확인해 주세요.');
  const guests = validateGuests(s?.guests || {});
  const guestIds = Object.keys(guests), allowedIds = [...knownIds, ...guestIds];
  if (!s || !validDate(s.date) || !Array.isArray(s.participantIds) || s.participantIds.length < 4 || new Set(s.participantIds).size !== s.participantIds.length || s.participantIds.some(id => !allowedIds.includes(id)) || guestIds.some(id => knownIds.includes(id) || !s.participantIds.includes(id)) || !Array.isArray(s.fixedPlayerIds) || new Set(s.fixedPlayerIds).size !== s.fixedPlayerIds.length || s.fixedPlayerIds.some(id => !s.participantIds.includes(id) || guestIds.includes(id)) || !s.matchMap || !Object.keys(s.matchMap).length || !/^\d{2}:\d{2}$/.test(s.startTime) || !Number.isInteger(s.roundMinutes) || s.roundMinutes < 10 || s.roundMinutes > 120) throw new Error('대진표 형식이 올바르지 않습니다.');
  if (guestIds.length && s.fixedPlayerIds.length !== s.participantIds.length - guestIds.length) throw new Error('회원과 게스트 명단을 확인해 주세요.');
  const availableRounds = s.endTime ? meetingWindow(s.startTime, s.endTime) : MAX_ROUNDS;
  if (s.endTime && s.roundMinutes !== 30) throw new Error('경기 시간은 30분 고정입니다.');
  const active = {}, counts = Object.fromEntries(s.participantIds.map(id => [id, 0]));
  for (const [key, m] of Object.entries(s.matchMap)) {
    const ids = [...(m.teamA || []), ...(m.teamB || [])];
    if (!Number.isInteger(m.round) || m.round < 1 || m.round > availableRounds || ![1, 2].includes(m.court) || key !== `r${m.round}-c${m.court}` || m.teamA.length !== 2 || m.teamB.length !== 2 || new Set(ids).size !== 4 || ids.some(id => !s.participantIds.includes(id))) throw new Error('대진표에 잘못된 경기가 있습니다.');
    active[m.round] ??= new Set();
    for (const id of ids) { if (active[m.round].has(id)) throw new Error('같은 라운드에 중복 출전이 있습니다.'); active[m.round].add(id); counts[id]++; }
  }
  if (Object.values(counts).some(n => n < 1 || n > availableRounds)) throw new Error('개인 경기 수를 모임 시간에 맞춰 주세요.');
  if (s.lockedPairs) {
    if (!Array.isArray(s.lockedPairs) || s.lockedPairs.some(pair => !Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1] || pair.some(id => !s.participantIds.includes(id))) || new Set(s.lockedPairs.flat()).size !== s.lockedPairs.flat().length) throw new Error('대회 준비 페어를 확인해 주세요.');
  }
  if (s.strengths && (typeof s.strengths !== 'object' || s.participantIds.some(id => !Number.isFinite(s.strengths[id]) || s.strengths[id] < 0 || s.strengths[id] > 1))) throw new Error('전력값은 0~1 숫자여야 합니다.');
  if (s.balance && ['averageGap', 'maxGap'].some(key => !Number.isFinite(s.balance[key]) || s.balance[key] < 0 || s.balance[key] > 2)) throw new Error('팀 전력 차이 형식이 올바르지 않습니다.');
  return s;
}


export function nextSunday(date) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + (7 - day.getUTCDay()) % 7);
  return day.toISOString().slice(0, 10);
}
