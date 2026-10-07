export const generationOf = session => session?.generation || 'legacy';
export const cancellationText = date => `${date} 대진 취소`;
export function requireCancellation(session, expectedGeneration, text) {
  if (!session || generationOf(session) !== expectedGeneration) throw new Error('대진이 변경되었거나 이미 취소됐습니다. 최신 대진을 확인해 주세요.');
  if (text !== cancellationText(session.date)) throw new Error('확인 문구를 정확히 입력해 주세요.');
}
export function resultFor(state, session, id) {
  if (!session) return undefined;
  const result = state.results[`${session.date}_${id}`];
  return result && generationOf(result) === generationOf(session) ? result : undefined;
}
export function discardSession(state, date, expectedGeneration, text) {
  requireCancellation(state.sessions[date], expectedGeneration, text);
  delete state.sessions[date];
  for (const key of Object.keys(state.results)) if (key.startsWith(`${date}_`)) delete state.results[key];
}
