import { meetingWindow, validDate } from './model.js';
import { validateGuests } from './guests.js';

const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const list = items => ({ type: 'array', items });
const string = { type: 'string' };
const member = object({ playerId: string, preference: { type: 'string', enum: ['early', 'late'] } });
export const planSchema = object({
  date: string, startTime: string, endTime: string,
  participantIds: list(string), guests: list(object({ id: string, name: string })),
  lockedPairs: list(list(string)), timingPreferences: list(member),
  quotas: list(object({ playerId: string, games: { type: 'integer' } })),
});
export const replySchema = object({ message: string, plan: { anyOf: [planSchema, { type: 'null' }] } });

export function validateAssistantPlan(plan, allowedMemberIds) {
  const fail = () => { throw new Error('제안한 대진 조건을 확인해 주세요.'); };
  if (!plan || typeof plan !== 'object' || Object.keys(plan).some(key => !Object.hasOwn(planSchema.properties, key)) || Object.keys(planSchema.properties).some(key => !Object.hasOwn(plan, key))) fail();
  if (!validDate(plan.date)) fail();
  const rounds = meetingWindow(plan.startTime, plan.endTime);
  if (!Array.isArray(plan.guests) || new Set(plan.guests.map(g => g?.id)).size !== plan.guests.length) fail();
  const guests = Object.fromEntries(plan.guests.map(g => { if (!g || Object.keys(g).some(k => !['id', 'name'].includes(k))) fail(); return [g.id, { name: g.name }]; }));
  validateGuests(guests);
  const ids = plan.participantIds, allowed = [...allowedMemberIds, ...Object.keys(guests)];
  if (!Array.isArray(ids) || ids.length < 4 || ids.length > 22 || new Set(ids).size !== ids.length || ids.some(id => !allowed.includes(id)) || Object.keys(guests).some(id => allowedMemberIds.includes(id) || !ids.includes(id))) fail();
  if (!Array.isArray(plan.lockedPairs) || plan.lockedPairs.some(p => !Array.isArray(p) || p.length !== 2 || p[0] === p[1] || p.some(id => !ids.includes(id))) || new Set(plan.lockedPairs.flat()).size !== plan.lockedPairs.flat().length) fail();
  if (!Array.isArray(plan.timingPreferences) || new Set(plan.timingPreferences.map(p => p?.playerId)).size !== plan.timingPreferences.length || plan.timingPreferences.some(p => !p || Object.keys(p).some(k => !['playerId', 'preference'].includes(k)) || !ids.includes(p.playerId) || !['early', 'late'].includes(p.preference))) fail();
  if (!Array.isArray(plan.quotas) || plan.quotas.some(q => !q || Object.keys(q).some(k => !['playerId', 'games'].includes(k)))) fail();
  const quotas = Object.fromEntries(plan.quotas.map(q => [q.playerId, q.games]));
  const capacity = ids.length >= 8 ? 8 : 4;
  if (plan.quotas.length) {
    if (plan.quotas.length !== ids.length || Object.keys(quotas).length !== ids.length || ids.some(id => !Number.isInteger(quotas[id]) || quotas[id] < 2 || quotas[id] > rounds)) fail();
    const total = Object.values(quotas).reduce((a, b) => a + b, 0);
    if (total % 4 || total > rounds * capacity || plan.lockedPairs.some(([a, b]) => quotas[a] !== quotas[b])) fail();
  } else if (rounds * capacity < ids.length * 2) fail();
  return structuredClone(plan);
}
