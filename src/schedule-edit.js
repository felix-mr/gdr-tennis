import { validateSession } from './model.js';

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
  // Validate on a copy: rejected edits leave the original preview untouched.
  if (Object.values(counts(next)).some(value => value < 2)) throw new Error('모든 참석자는 최소 2경기를 해야 합니다. 다른 라운드에서 먼저 출전을 추가해 주세요.');
  try { validateSession(next, next.fixedPlayerIds); }
  catch { throw new Error('같은 라운드에 중복 출전하게 됩니다. 다른 자리를 선택해 주세요.'); }
  for (const pair of next.lockedPairs || []) if (pairBreaks(next, pair) > pairBreaks(session, pair)) throw new Error('고정 페어가 나뉘게 됩니다. 팀 이동으로 두 명을 함께 바꿔 주세요.');
  const paired = new Map(), fixed = new Set((next.lockedPairs || []).map(pair => [...pair].sort().join('|')));
  for (const match of Object.values(next.matchMap)) for (const team of [match.teamA, match.teamB]) {
    const key = [...team].sort().join('|');
    if (!fixed.has(key)) paired.set(key, (paired.get(key) || 0) + 1);
  }
  next.partnerRepeats = [...paired.values()].reduce((sum, n) => sum + Math.max(0, n - 1), 0);
  return next;
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
