import './admin.css';
import { createAdminClient } from './admin-client.js';
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const accountKey = 'gdr-default-admin-email';
export function mountAdminView({ element, getContext, applyPlan, names, clientFactory = createAdminClient }) {
  let client, user, account, messages = [], plan = null, agents = [{ id: 'scheduler', name: '대진 도우미' }, { id: 'reviewer', name: '조건 검토 도우미' }], agentId = 'scheduler', busy = false, error = '', epoch = 0, pending = null;
  const get = selector => element.querySelector(selector);
  function rememberedEmail() { try { return localStorage.getItem(accountKey) || ''; } catch { return ''; } }
  function rememberEmail(email) { try { if (!localStorage.getItem(accountKey)) localStorage.setItem(accountKey, email); } catch {} }
  function render() {
    const text = get('#admin-message')?.value || '';
    element.innerHTML = `<div class="section-heading"><div><h2>관리자 대화</h2><p>대화로 조건을 정하고, 대진을 확인한 뒤 확정하세요.</p></div></div><p id="admin-error" class="admin-error" role="alert" ${error ? '' : 'hidden'}>${esc(error)}</p>`;
    if (!user) {
      element.insertAdjacentHTML('beforeend', `<div class="admin-login panel"><h3>관리자 로그인</h3><p class="hint">등록된 관리자 계정으로 로그인하세요.</p><form id="admin-login-form"><label>이메일<input name="email" type="email" autocomplete="username" required value="${esc(rememberedEmail())}"></label><label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label><button class="primary" ${busy ? 'disabled' : ''}>${busy ? '확인 중…' : '로그인'}</button></form></div>`);
      return;
    }
    if (!account) { element.insertAdjacentHTML('beforeend', `<div class="panel"><p role="status">${busy ? '관리자 계정 확인 중…' : '관리자 연결을 확인해 주세요.'}</p><button id="admin-switch" class="secondary">다른 계정으로 로그인</button>${!busy ? '<button id="admin-reload" class="secondary">다시 연결</button>' : ''}</div>`); return; }
    element.insertAdjacentHTML('beforeend', `<div class="admin-account"><div><strong>${esc(account.name)}</strong><small>${esc(account.email)}</small></div><button id="admin-switch" class="secondary">계정 변경</button></div><div class="admin-workspace"><div class="admin-chat panel"><div class="panel-top"><h3>대진 상담</h3><label>에이전트<select id="admin-agent" ${busy ? 'disabled' : ''}>${agents.map(a => `<option value="${esc(a.id)}" ${a.id === agentId ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label></div><div id="admin-messages" class="admin-messages" role="log" aria-live="polite">${messages.length ? messages.map(m => `<div class="admin-bubble ${m.role === 'user' ? 'user' : 'assistant'}"><small>${m.role === 'user' ? '나' : esc(agents.find(a => a.id === agentId)?.name || '도우미')}</small><p>${esc(m.content)}</p></div>`).join('') : '<div class="admin-empty"><h3>이번 모임은 어떻게 진행할까요?</h3><p>참석자, 시간, 원하는 페어와 경기 수를 알려주세요.<br>추가 조건은 이어서 대화하며 수정할 수 있어요.</p></div>'}${busy ? '<p class="hint" role="status">도우미가 조건을 확인하고 있어요…</p>' : ''}</div><form id="admin-chat-form"><label class="sr-only" for="admin-message">대진 조건과 질문</label><textarea id="admin-message" name="message" maxlength="2000" rows="3" placeholder="참석자와 모임 시간, 원하는 조건을 입력하세요." required ${busy ? 'disabled' : ''}>${esc(text)}</textarea><div class="admin-compose-bottom"><span class="hint">대화는 이 계정에 보관됩니다.</span><button class="primary" ${busy ? 'disabled' : ''}>보내기</button></div></form></div><aside class="admin-proposal panel"><h3>대진 설정 제안</h3>${plan ? `<p class="admin-plan-date">${esc(plan.date)}<br><strong>${esc(plan.startTime)}–${esc(plan.endTime)}</strong></p><h4>참석 ${plan.participantIds.length}명</h4><p>${plan.participantIds.map(id => esc(names[id] || plan.guests.find(g => g.id === id)?.name || id)).join(' · ')}</p><h4>고정 페어 ${plan.lockedPairs.length}조</h4>${plan.lockedPairs.map(pair => `<p>${pair.map(id => esc(names[id] || plan.guests.find(g => g.id === id)?.name || id)).join(' · ')}</p>`).join('')}<p class="hint">${plan.quotas.length ? '개인별 경기 수 지정' : '경기 수 자동 배분'} · 경기 순서 선호 ${plan.timingPreferences.length}명</p><button id="admin-preview" class="primary" ${busy ? 'disabled' : ''}>대진 미리보기 만들기</button><p class="hint">미리보기 생성 후 대진 편성 화면에서 확인하고 확정하세요.</p>` : '<p class="hint">대화에서 조건이 정리되면 제안을 보여드려요.</p>'}</aside></div>`);
    const log = get('#admin-messages'); if (log) log.scrollTop = log.scrollHeight;
  }
  function showError(exception) {
    if (exception.code?.includes('invalid-credential') || exception.code?.includes('wrong-password') || exception.code?.includes('user-not-found')) error = '이메일 또는 비밀번호를 확인해 주세요.';
    else if (exception.code?.includes('configuration-not-found') || exception.code?.includes('operation-not-allowed')) error = '관리자 로그인 연결 설정이 필요합니다.';
    else error = exception.message?.replace(/^Firebase:\s*/, '') || '연결에 실패했습니다. 다시 시도해 주세요.';
  }
  async function load() {
    const current = ++epoch; account = null; messages = []; plan = null; pending = null; busy = true; error = ''; render();
    try { const state = await client.state(agentId); if (current !== epoch || !user) return; account = state.account; rememberEmail(account.email); agents = state.agents; messages = state.messages; plan = state.plan; }
    catch (exception) { if (current === epoch) showError(exception); }
    finally { if (current === epoch) { busy = false; render(); } }
  }
  element.addEventListener('submit', async event => {
    if (!['admin-login-form', 'admin-chat-form'].includes(event.target.id)) return;
    event.preventDefault();
    if (busy) return;
    const form = event.target;
    if (form.id === 'admin-login-form') {
      const email = form.elements.email.value.trim(), password = form.elements.password.value;
      busy = true; error = ''; render();
      try { client ||= await clientFactory(); if (!client.observing) { client.observing = true; client.observe(next => { ++epoch; user = next; account = null; messages = []; plan = null; pending = null; error = ''; busy = false; if (next) load(); else render(); }); } await client.login(email, password); }
      catch (exception) { showError(exception); busy = false; render(); }
      return;
    }
    const message = form.elements.message.value.trim(); if (!message || !account) return;
    const current = epoch;
    pending = pending?.message === message ? pending : { requestId: crypto.randomUUID(), message };
    busy = true; error = ''; render();
    try {
      const reply = await client.send({ agentId, ...pending, context: getContext() });
      if (current !== epoch || !user) return;
      messages = [...messages, { role: 'user', content: message }, { role: 'assistant', content: reply.message }];
      if (reply.plan) plan = reply.plan;
      pending = null; get('#admin-message').value = '';
    } catch (exception) { if (current === epoch) showError(exception); }
    finally { if (current === epoch) { busy = false; render(); } }
  });
  element.addEventListener('change', event => { if (event.target.id === 'admin-agent') { agentId = event.target.value; load(); } });
  element.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.id === 'admin-switch') { ++epoch; user = null; account = null; messages = []; plan = null; pending = null; busy = false; error = ''; render(); try { await client?.logout(); } catch (exception) { showError(exception); render(); } }
    else if (button.id === 'admin-reload') load();
    else if (button.id === 'admin-preview' && plan && !busy) { try { await applyPlan(structuredClone(plan)); } catch (exception) { showError(exception); render(); } }
  });
  render();
  return { async open() {
    if (client?.observing) return;
    try { client ||= await clientFactory(); client.observing = true; client.observe(next => { ++epoch; user = next; account = null; messages = []; plan = null; pending = null; error = ''; busy = false; if (next) load(); else render(); }); }
    catch (exception) { showError(exception); render(); }
  } };
}
