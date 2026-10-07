// Immutable rounds are stored separately so each Firestore rule evaluates a
// single round even when a longer meeting produces many matches.
export function encodeSession(session) {
  const { matchMap, ...header } = session;
  return { ...header, schemaVersion: 2, roundCount: Math.max(...Object.values(matchMap).map(match => match.round)), matchCount: Object.keys(matchMap).length, lockedPairs: (session.lockedPairs || []).map(([first, second]) => ({ first, second })) };
}

export function encodeRounds(session) {
  const rounds = {};
  for (const [key, match] of Object.entries(session.matchMap)) {
    rounds[match.round] ??= { round: match.round, matchMap: {} };
    rounds[match.round].matchMap[key] = match;
  }
  return rounds;
}

export function decodeSession(session, roundDocuments = []) {
  if (session.schemaVersion !== 2) return { ...session, lockedPairs: (session.lockedPairs || []).map(pair => [pair.first, pair.second]) };
  if (!Number.isInteger(session.roundCount) || session.roundCount < 1 || !Number.isInteger(session.matchCount) || session.matchCount < session.roundCount || session.matchCount > session.roundCount * 2 || roundDocuments.some(round => !Number.isInteger(round.round) || round.round < 1 || round.round > session.roundCount || Object.values(round.matchMap || {}).some(match => match.round !== round.round))) throw new Error('저장된 라운드 형식을 확인해 주세요.');
  const matches = roundDocuments.flatMap(round => Object.entries(round.matchMap || {}));
  if (roundDocuments.length !== session.roundCount || matches.length !== session.matchCount || new Set(roundDocuments.map(round => round.round)).size !== session.roundCount || new Set(matches.map(([key]) => key)).size !== matches.length) throw new Error('저장된 라운드 수를 확인해 주세요.');
  const { roundCount, matchCount, ...header } = session;
  return { ...header, schemaVersion: 1, matchMap: Object.fromEntries(matches), lockedPairs: (session.lockedPairs || []).map(pair => [pair.first, pair.second]) };
}
