import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAssistantPlan } from '../src/assistant-plan.js';
import { askAgent, agents, encodePlan, decodePlan, isAdministrator, conversationPath } from '../functions/agent-core.js';
import { toFirestoreValue } from '../scripts/firestore-values.js';
const ids = ['a', 'b', 'c', 'd'];
const plan = () => ({ date: '2026-10-18', startTime: '19:00', endTime: '21:00', participantIds: [...ids], guests: [], lockedPairs: [['a', 'b']], timingPreferences: [{ playerId: 'c', preference: 'late' }], quotas: [] });

test('only enabled users with an explicit administrator claim qualify', () => {
  for (const user of [null, {}, { customClaims: { gdrAdmin: 'true' } }, { disabled: true, customClaims: { gdrAdmin: true } }]) assert.equal(isAdministrator(user), false);
  assert.equal(isAdministrator({ disabled: false, customClaims: { gdrAdmin: true } }), true);
  assert.notEqual(conversationPath('owner', 'scheduler'), conversationPath('other', 'scheduler'));
  assert.notEqual(conversationPath('owner', 'scheduler'), conversationPath('owner', 'reviewer'));
  for (const uid of ['../other', 'owner/agents/reviewer', '']) assert.throws(() => conversationPath(uid, 'scheduler'));
  assert.throws(() => conversationPath('owner', 'unknown'));
});

test('AI plans reject unsupported participants, malformed times, overlapping pairs and invalid quotas', () => {
  assert.deepEqual(validateAssistantPlan(plan(), ids), plan());
  for (const change of [
    { participantIds: ['a', 'b', 'c', 'unknown'] }, { startTime: '19:15' }, { endTime: '18:00' },
    { lockedPairs: [['a', 'b'], ['b', 'c']] }, { timingPreferences: [{ playerId: 'z', preference: 'late' }] },
    { quotas: [{ playerId: 'a', games: 3 }] },
    { quotas: ids.map(playerId => ({ playerId, games: 5 })) },
    { arbitraryAction: 'save-records' },
  ]) assert.throws(() => validateAssistantPlan({ ...plan(), ...change }, ids));
  const guest = { ...plan(), participantIds: ['a', 'b', 'c', 'guest001'], guests: [{ id: 'guest001', name: '게스트' }], lockedPairs: [] };
  assert.deepEqual(validateAssistantPlan(guest, ids), guest);
  assert.throws(() => validateAssistantPlan({ ...guest, guests: [{ id: 'a', name: '잘못된 게스트' }] }, ids));
});

test('stored proposals encode preparation pairs without Firestore nested arrays', () => {
  const encoded = encodePlan(plan());
  assert.doesNotThrow(() => toFirestoreValue(encoded));
  assert.deepEqual(decodePlan(encoded), plan());
  assert.equal(decodePlan(encodePlan(null)), null);
});

test('Responses requests preserve conversation, keep keys server-side, disable remote storage and validate returned plans', async () => {
  let sent;
  const reply = { message: '조건을 확인해 주세요.', plan: plan() };
  const result = await askAgent({ apiKey: 'test-only-key', model: 'configured-model', agent: agents[0], messages: [{ role: 'user', content: '이번 모임 대진을 준비해줘' }], context: { plan: plan() }, allowedIds: () => ids,
    fetcher: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.headers.Authorization, 'Bearer test-only-key');
      sent = JSON.parse(options.body);
      assert.ok(!options.body.includes('test-only-key'));
      return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(reply) }] }] }) };
    },
  });
  assert.deepEqual(result, reply);
  assert.equal(sent.store, false);
  assert.equal(sent.model, 'configured-model');
  assert.equal(sent.text.format.strict, true);
  assert.equal(sent.input.at(-1).content, '이번 모임 대진을 준비해줘');
});

test('AI refusal, incomplete output, malformed JSON and invalid proposals do not apply settings', async () => {
  const call = data => askAgent({ apiKey: 'test-only-key', model: 'configured-model', agent: agents[0], messages: [], context: {}, allowedIds: () => ids, fetcher: async () => ({ ok: true, json: async () => data }) });
  assert.equal((await call({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] })).plan, null);
  await assert.rejects(call({ status: 'incomplete', output: [] }));
  for (const text of ['not json', JSON.stringify({ message: '반영했습니다.', plan: { ...plan(), participantIds: ['a', 'b', 'c', 'unknown'] } })]) {
    await assert.rejects(call({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }));
  }
  await assert.rejects(askAgent({ apiKey: '', model: 'configured-model' }));
});
