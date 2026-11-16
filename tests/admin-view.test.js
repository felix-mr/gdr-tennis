import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
const source = (await readFile(new URL('../src/admin-view.js', import.meta.url), 'utf8')).replace("import './admin.css';", '').replace("'./admin-client.js'", JSON.stringify(new URL('../src/admin-client.js', import.meta.url).href));
const { mountAdminView } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const flush = () => new Promise(resolve => setTimeout(resolve, 5));
const plan = { date: '2026-10-18', startTime: '19:00', endTime: '21:00', participantIds: ['a', 'b', 'c', 'd'], guests: [], lockedPairs: [], timingPreferences: [], quotas: [] };
async function setup(send) {
  const dom = new JSDOM('<section id="admin"></section>', { url: 'http://localhost' });
  globalThis.localStorage = dom.window.localStorage;
  const element = dom.window.document.querySelector('#admin'), applied = [];
  let observer, currentEmail;
  const client = {
    observe(fn) { observer = fn; fn(null); },
    async login(email) { currentEmail = email; observer({ uid: email }); },
    async logout() { observer(null); },
    async state() { return { account: { name: '테스트 관리자', email: currentEmail }, agents: [{ id: 'scheduler', name: '대진 도우미' }, { id: 'reviewer', name: '조건 검토 도우미' }], messages: [], plan: null }; },
    send,
  };
  mountAdminView({ element, names: { a: 'A', b: 'B', c: 'C', d: 'D' }, getContext: () => ({ plan }), applyPlan: proposal => applied.push(proposal), clientFactory: async () => client });
  async function login(email = 'owner@example.invalid') {
    element.querySelector('[name=email]').value = email;
    element.querySelector('[name=password]').value = 'test-only-password';
    element.querySelector('#admin-login-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await flush();
  }
  function sendMessage(message = '대진 준비해줘') {
    element.querySelector('#admin-message').value = message;
    element.querySelector('#admin-chat-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  }
  return { element, dom, applied, login, sendMessage };
}

test('administrator view treats AI text as text and applies only an explicit preview action', async () => {
  let request;
  const view = await setup(async data => { request = data; return { message: '<img src=x onerror="alert(1)">', plan }; });
  await view.login();
  assert.equal(view.element.querySelector('[name=password]'), null);
  view.sendMessage(); await flush();
  assert.equal(view.element.querySelector('#admin-messages img'), null);
  assert.ok(view.element.textContent.includes('<img'));
  assert.equal(view.applied.length, 0);
  view.element.querySelector('#admin-preview').click();
  assert.deepEqual(view.applied, [plan]);
  assert.equal(request.context.plan, plan);
  assert.equal(request.agentId, 'scheduler');
  assert.ok(!JSON.stringify(request).includes('test-only-password'));
  view.dom.window.close();
});

test('account switching clears private content and rejects delayed responses from the previous account', async () => {
  let complete;
  const view = await setup(() => new Promise(resolve => { complete = resolve; }));
  await view.login();
  view.sendMessage('오래 걸리는 요청'); await flush();
  view.element.querySelector('#admin-switch').click(); await flush();
  complete({ message: '이전 계정 비공개 응답', plan }); await flush();
  assert.ok(!view.element.textContent.includes('이전 계정 비공개 응답'));
  assert.equal(view.element.querySelector('#admin-messages'), null);
  assert.equal(view.element.querySelector('[name=email]').value, 'owner@example.invalid');
  await view.login('other@example.invalid');
  assert.ok(view.element.textContent.includes('other@example.invalid'));
  assert.ok(!view.element.textContent.includes('owner@example.invalid'));
  assert.equal(view.element.querySelector('#admin-preview'), null);
  view.dom.window.close();
});
