import { validateSession } from './model.js';
import { sessionNames } from './guests.js';

function resolve(session, slot) {
  if (slot?.kind === 'rest') {
    if (!Number.isInteger(slot.round) || !Object.values(session.matchMap).some(match => match.round === slot.round) || !session.participantIds.includes(slot.playerId) || Object.values(session.matchMap).some(match => match.round === slot.round && [...match.teamA, ...match.teamB].includes(slot.playerId))) throw new Error('휴식 자리가 변경됐습니다. 다시 선택해 주세요.');
    return { slot, ids: [slot.playerId], round: slot.round };
  }
  const match = session.matchMap[slot?.matchId];
  if (!match || !['teamA', 'teamB'].includes(slot.side) || !['player', 'team'].includes(slot.kind)) throw new Error('바꿀 자리를 다시 선택해 주세요.');
  const team = match[slot.side];
  if (slot.kind === 'player' && (![0, 1].includes(slot.index) || team[slot.index] !== slot.playerId)) throw new Error('선수 자리가 변경됐습니다. 다시 선택해 주세요.');
  if (slot.kind === 'team' && (!Array.isArray(slot.playerIds) || team.some((id, index) => id !== slot.playerIds[index]) || slot.playerIds.length !== 2)) throw new Error('팀 자리가 변경됐습니다. 다시 선택해 주세요.');
  return { slot, ids: slot.kind === 'team' ? [...team] : [team[slot.index]], round: match.round };
}

const counts = session => Object.fromEntries(session.participantIds.map(id => [id, Object.values(session.matchMap).filter(match => [...match.teamA, ...match.teamB].includes(id)).length]));
const pairBreaks = (session, pair) => Object.values(session.matchMap).filter(match => [...match.teamA, ...match.teamB].some(id => pair.includes(id)) && ![match.teamA, match.teamB].some(team => pair.every(id => team.includes(id)))).length;

export function swapAssignments(session, first, second) {
  const a = resolve(session, first), b = resolve(session, second);
  if ((first.kind === 'team') !== (second.kind === 'team')) throw new Error('같은 종류의 자리를 선택해 주세요.');
  if (first.kind === 'rest' && second.kind === 'rest') throw new Error('경기 중인 선수와 휴식자를 선택해 주세요.');
  if (a.ids.length === b.ids.length && a.ids.every(id => b.ids.includes(id))) throw new Error('서로 다른 선수·팀을 선택해 주세요.');
  if ((first.kind === 'rest' || second.kind === 'rest') && a.round !== b.round) throw new Error('휴식자는 같은 라운드의 선수와 바꿔 주세요.');
  const next = structuredClone(session);
  const put = (item, replacement) => {
    if (item.slot.kind === 'rest') return;
    const match = next.matchMap[item.slot.matchId];
    if (item.slot.kind === 'team') match[item.slot.side] = [...replacement];
    else match[item.slot.side][item.slot.index] = replacement[0];
  };
  put(a, b.ids); put(b, a.ids);
  // Intermediate edits may be invalid while several slots are being moved.
  // Validate the complete working copy only when the editor applies it.
  const paired = new Map(), fixed = new Set((next.lockedPairs || []).map(pair => [...pair].sort().join('|')));
  for (const match of Object.values(next.matchMap)) for (const team of [match.teamA, match.teamB]) {
    const key = [...team].sort().join('|');
    if (!fixed.has(key)) paired.set(key, (paired.get(key) || 0) + 1);
  }
  next.partnerRepeats = [...paired.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0);
  return next;
}

export function validateManualSchedule(session, names = {}) {
  const labels = sessionNames(session, names), label = id => labels[id] || id;
  const issues = [], active = new Map();
  for (const match of Object.values(session.matchMap)) {
    if (!active.has(match.round)) active.set(match.round, new Map());
    const players = active.get(match.round);
    for (const id of [...match.teamA, ...match.teamB]) players.set(id, (players.get(id) || 0) + 1);
  }
  for (const [round, players] of [...active].sort(([a], [b]) => a - b)) {
    const repeated = [...players].filter(([, n]) => n > 1).map(([id]) => label(id));
    if (repeated.length) issues.push(`${round}라운드 중복 출전: ${repeated.join(' · ')}`);
  }
  const short = Object.entries(counts(session)).filter(([, n]) => n < 2).map(([id]) => label(id));
  if (short.length) issues.push(`최소 2경기가 필요합니다: ${short.join(' · ')}`);
  const split = (session.lockedPairs || []).filter(pair => pairBreaks(session, pair));
  if (split.length) issues.push(`고정 페어를 함께 배치해 주세요: ${split.map(pair => pair.map(label).join(' · ')).join(' / ')}`);
  if (issues.length) throw new Error(issues.join('\n'));
  validateSession(session, session.fixedPlayerIds);
  return session;
}

export function manualScheduleNotes(session) {
  const games = counts(session), notes = [];
  if (Math.max(...Object.values(games)) - Math.min(...Object.values(games)) > 1) notes.push('수정 후 개인 경기 수 차이가 2경기 이상입니다.');
  const rounds = [...new Set(Object.values(session.matchMap).map(match => match.round))].sort((a, b) => a - b);
  const resting = [];
  for (const id of session.participantIds) {
    const played = rounds.filter(round => Object.values(session.matchMap).some(match => match.round === round && [...match.teamA, ...match.teamB].includes(id)));
    if (played.some((round, index) => index && round - played[index - 1] > 2)) resting.push(id);
  }
  if (session.partnerRepeats) notes.push(`같은 파트너 ${session.partnerRepeats}회 반복됩니다.`);
  return { games, notes, resting };
}
