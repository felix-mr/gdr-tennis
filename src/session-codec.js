// Firestore does not accept arrays nested directly inside another array.
export function encodeSession(session) {
  return { ...session, lockedPairs: (session.lockedPairs || []).map(([first, second]) => ({ first, second })) };
}

export function decodeSession(session) {
  return { ...session, lockedPairs: (session.lockedPairs || []).map(pair => [pair.first, pair.second]) };
}
