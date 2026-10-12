import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import players from '../data/players.json' with { type: 'json' };
import periods from '../data/periods.json' with { type: 'json' };
import { membersForPeriod } from '../src/roster.js';
import { validateAssistantPlan } from '../src/assistant-plan.js';
import { agents, askAgent, encodePlan, decodePlan, isAdministrator, conversationPath } from './agent-core.js';

initializeApp();
const db = getFirestore();
const apiKey = defineSecret('OPENAI_API_KEY');
const model = defineString('OPENAI_MODEL');
const options = { region: 'asia-northeast3', maxInstances: 2, concurrency: 4, memory: '512MiB', timeoutSeconds: 90, cors: ['https://felix-mr.github.io', /^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] };
const allowedIds = date => membersForPeriod(date, players, periods).map(p => p.id);
async function admin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', '관리자 로그인이 필요합니다.');
  const user = await getAuth().getUser(request.auth.uid);
  if (!isAdministrator(user)) throw new HttpsError('permission-denied', '관리자 계정만 사용할 수 있습니다.');
  return user;
}
function agentFor(id) {
  const agent = agents.find(a => a.id === id);
  if (!agent) throw new HttpsError('invalid-argument', '에이전트를 확인해 주세요.');
  return agent;
}
const threadFor = (uid, agentId) => db.doc(conversationPath(uid, agentId));

export const adminChatState = onCall(options, async request => {
  const user = await admin(request);
  const agent = agentFor(request.data?.agentId);
  const doc = await threadFor(user.uid, agent.id).get();
  const data = doc.data() || {};
  return { account: { name: user.displayName || '관리자', email: user.email || '' }, agents: agents.map(({ id, name }) => ({ id, name })), messages: data.messages || [], plan: decodePlan(data.plan) };
});

export const adminChat = onCall({ ...options, secrets: [apiKey] }, async request => {
  const user = await admin(request);
  const agent = agentFor(request.data?.agentId);
  const { message, requestId, context } = request.data || {};
  if (typeof message !== 'string' || !message.trim() || message.length > 2000 || !/^[a-f0-9-]{36}$/.test(requestId || '') || !context || JSON.stringify(context).length > 24000) throw new HttpsError('invalid-argument', '대진 조건을 2,000자 이내로 입력해 주세요.');
  let initialPlan;
  try { initialPlan = validateAssistantPlan(context.plan, allowedIds(context.plan?.date)); } catch { throw new HttpsError('invalid-argument', '현재 참석자와 모임 시간 설정을 확인해 주세요.'); }
  const ref = threadFor(user.uid, agent.id), usage = db.doc(`clubs/gdr/adminChatUsage/${user.uid}`);
  const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
  const state = await db.runTransaction(async tx => {
    const [thread, quota] = await Promise.all([tx.get(ref), tx.get(usage)]);
    const saved = thread.data() || {}, limits = quota.data() || {};
    if (saved.lastRequestId === requestId && saved.lastReply) return { cached: { ...saved.lastReply, plan: decodePlan(saved.lastReply.plan) } };
    if (saved.pendingUntil > now) throw new HttpsError('aborted', '이전 응답을 기다린 뒤 다시 입력해 주세요.');
    const daily = limits.day === day ? limits.daily || 0 : 0;
    const minute = limits.minuteStart > now - 60000 ? limits.minute || 0 : 0;
    if (daily >= 60 || minute >= 6) throw new HttpsError('resource-exhausted', '대화 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.');
    tx.set(usage, { day, daily: daily + 1, minute: minute + 1, minuteStart: minute ? limits.minuteStart : now });
    tx.set(ref, { pendingRequestId: requestId, pendingUntil: now + 120000 }, { merge: true });
    return { messages: saved.messages || [], plan: decodePlan(saved.plan) || initialPlan };
  });
  if (state.cached) return state.cached;
  try {
    const messages = [...state.messages.slice(-30), { role: 'user', content: message.trim() }];
    const reply = await askAgent({ apiKey: apiKey.value(), model: model.value(), agent, messages, context: { plan: state.plan, roster: players.map(({ id, name, shortName }) => ({ id, name, shortName })), today: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }, allowedIds });
    await db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      if (doc.data()?.pendingRequestId !== requestId) throw new HttpsError('aborted', '대화가 변경됐습니다. 다시 확인해 주세요.');
      tx.set(ref, { messages: [...messages, { role: 'assistant', content: reply.message }].slice(-40), plan: encodePlan(reply.plan || state.plan), lastRequestId: requestId, lastReply: { ...reply, plan: encodePlan(reply.plan) }, pendingRequestId: FieldValue.delete(), pendingUntil: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });
    return reply;
  } catch (error) {
    await db.runTransaction(async tx => { const doc = await tx.get(ref); if (doc.data()?.pendingRequestId === requestId) tx.update(ref, { pendingRequestId: FieldValue.delete(), pendingUntil: FieldValue.delete() }); });
    if (error instanceof HttpsError) throw error;
    throw new HttpsError('unavailable', error.message?.startsWith('AI') || error.message?.startsWith('제안한') ? error.message : '대화 처리에 실패했습니다. 다시 시도해 주세요.');
  }
});
