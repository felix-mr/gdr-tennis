import { validDate, validResult } from './model.js';

const fresh = () => ({ games: 0, wins: 0, draws: 0, losses: 0, scored: 0, conceded: 0, records: [] });
const finish = row => ({ ...row, difference: row.scored - row.conceded, winRate: row.games ? Math.round(100 * row.wins / row.games) : null });

// Guests have a meeting-local identity. Never merge guest001 across dates.
export function personalMatchups(records, playerId, names = {}) {
  const partners = new Map(), opponents = new Map(), total = fresh(), seen = new Set();
  for (const record of records) {
    if (!Array.isArray(record?.teamA) || !Array.isArray(record?.teamB)) continue;
    const ids = [...(record.teamA || []), ...(record.teamB || [])];
    if (!validDate(record.date) || !validResult(record) || record.teamA?.length !== 2 || record.teamB?.length !== 2 || new Set(ids).size !== 4 || !record.fixedPlayerIds?.includes(playerId) || !ids.includes(playerId)) continue;
    const matchKey = `${record.date}/${record.round}/${record.court}`;
    if (seen.has(matchKey)) continue;
    seen.add(matchKey);
    const side = record.teamA.includes(playerId) ? 'teamA' : 'teamB';
    const other = side === 'teamA' ? 'teamB' : 'teamA';
    const partner = record[side].find(id => id !== playerId);
    const identity = id => Object.hasOwn(record.guests || {}, id) ? `${record.date}:${id}` : id;
    const label = id => record.guests?.[id]?.name || names[id] || id;
    const entries = [
      [partners, identity(partner), [partner]],
      [opponents, record[other].map(identity).sort().join('|'), [...record[other]].sort((a, b) => label(a).localeCompare(label(b), 'ko'))],
    ];
    const won = record.outcome === side, drawn = record.outcome === 'draw';
    for (const [map, key, memberIds] of entries) {
      if (!map.has(key)) map.set(key, { ...fresh(), key, names: memberIds.map(label), guest: memberIds.some(id => Object.hasOwn(record.guests || {}, id)) });
    }
    for (const row of [total, ...entries.map(([map, key]) => map.get(key))]) {
      row.games++; row.wins += Number(won); row.draws += Number(drawn); row.losses += Number(!won && !drawn);
      row.scored += side === 'teamA' ? record.scoreA : record.scoreB;
      row.conceded += side === 'teamA' ? record.scoreB : record.scoreA;
      row.records.push(record);
    }
  }
  const rows = map => [...map.values()].map(finish).sort((a, b) => b.games - a.games || a.names.join(' ').localeCompare(b.names.join(' '), 'ko'));
  return { total: finish(total), partners: rows(partners), opponents: rows(opponents) };
}

export function archivedPartnerRows(sets, playerId) {
  return sets.filter(set => set.kind === 'partner-aggregate').flatMap(set => set.rows
    .filter(row => row.playerIds?.includes(playerId) && row.playerIds.every(Boolean) && row.status === 'validated-pair-aggregate' && row.stats)
    .map(row => ({ ...row, partnerName: row.names[row.playerIds[0] === playerId ? 1 : 0], datasetTitle: set.title, datasetId: set.id, cutoff: set.cutoff })));
}
