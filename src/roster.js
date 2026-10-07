import { quarter } from './model.js';
import { withinPeriod, quarterBounds } from './periods.js';

export function membersForPeriod(value, players, periods, sessions = {}) {
  if (value === 'all') return [...players];
  const range = typeof value === 'object', period = range || /^\d{4}-[QH]/.test(value);
  const configured = periods.filter(entry => {
    const bounds = quarterBounds(entry.id), start = entry.startsOn || bounds.start, end = entry.endsBefore || bounds.endBefore;
    return range ? start <= value.end && end > value.start : period ? entry.id === value || withinPeriod(value, start) : entry.id === quarter(value);
  }).flatMap(entry => entry.memberIds);
  const relevant = Object.values(sessions).filter(session => withinPeriod(value, session.date));
  const ids = new Set(period ? configured : sessions[value]?.fixedPlayerIds || configured);
  for (const session of relevant) for (const memberId of session.fixedPlayerIds) ids.add(memberId);
  return players.filter(player => ids.has(player.id));
}
