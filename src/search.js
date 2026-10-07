export function matchesName(name, query) {
  const normalize = value => String(value || '').normalize('NFC').toLocaleLowerCase('ko').replace(/\s+/g, '');
  return normalize(name).includes(normalize(query));
}

export function matchesPlayer(player, query) { return matchesName(player.name, query) || matchesName(player.shortName, query); }
export function matchesRecord(record, players, query) {
  if (!query.trim()) return true;
  const members = new Map(players.map(player => [player.id, player]));
  return [...record.teamA, ...record.teamB].some(id => members.has(id) ? matchesPlayer(members.get(id), query) : matchesName(record.guests?.[id]?.name, query));
}
