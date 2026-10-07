import { quarter } from './model.js';

export function membersForPeriod(value, players, periods, sessions = {}) {
  if (value === 'all') return [...players];
  const id = value.includes('-Q') ? value : quarter(value);
  const configured = periods.find(period => period.id === id)?.memberIds || [];
  const relevant = Object.values(sessions).filter(session => value.includes('-Q') ? quarter(session.date) === id : session.date === value);
  const ids = new Set(value.includes('-Q') ? configured : sessions[value]?.fixedPlayerIds || configured);
  for (const session of relevant) for (const memberId of session.fixedPlayerIds) ids.add(memberId);
  return players.filter(player => ids.has(player.id));
}
