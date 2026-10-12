import { swapAssignments, manualScheduleNotes } from './schedule-edit.js';
import { sessionNames } from './guests.js';

const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function openScheduleEditor(original, names, onApply) {
  if (document.querySelector('#schedule-editor')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'schedule-editor'; dialog.className = 'schedule-editor';
  dialog.setAttribute('aria-labelledby', 'schedule-editor-title');
  let current = structuredClone(original), mode = 'player', selected = null, stack = [], message = '', error = false;
  const labels = sessionNames(current, names), slots = new Map();
  const slotKey = slot => slot.kind === 'rest' ? `rest-${slot.round}-${slot.playerId}` : `${slot.matchId}-${slot.side}-${slot.kind === 'team' ? 'team' : slot.index}`;
  const button = (slot, label) => {
    const key = slotKey(slot); slots.set(key, slot);
    return `<button type="button" class="assignment-slot ${slot.kind === 'rest' ? 'rest-slot' : ''}" data-slot="${esc(key)}" aria-pressed="${selected && slotKey(selected) === key ? 'true' : 'false'}">${esc(label)}</button>`;
  };
  function render() {
    const scroll = dialog.querySelector('.assignment-rounds')?.scrollTop || 0;
    slots.clear();
    const rounds = [...new Set(Object.values(current.matchMap).map(match => match.round))].sort((a, b) => a - b);
    const { games, notes, resting } = manualScheduleNotes(current);
    if (resting.length) notes.push(`${resting.map(id => labels[id]).join(' · ')}: 2회 이상 연속 휴식합니다.`);
    dialog.innerHTML = `<div class="assignment-header"><div><span class="label-tag">확정 전 수정</span><h2 id="schedule-editor-title">대진 직접 수정</h2></div><button type="button" id="assignment-close" class="text-button">닫기</button></div><div class="assignment-controls"><div class="assignment-modes" role="group" aria-label="교체 방식"><button type="button" data-mode="player" aria-pressed="${mode === 'player'}">선수 교체</button><button type="button" data-mode="team" aria-pressed="${mode === 'team'}">팀 이동</button></div><button type="button" id="assignment-undo" class="text-button" ${stack.length ? '' : 'disabled'}>되돌리기</button><button type="button" id="assignment-reset" class="text-button" ${stack.length ? '' : 'disabled'}>처음 대진</button></div><p class="assignment-instruction">${mode === 'player' ? '선수 두 명을 눌러 자리를 바꾸세요. 휴식자는 같은 라운드의 선수와 교체할 수 있습니다.' : '팀 두 개를 눌러 자리를 바꾸세요. 고정 페어도 함께 이동합니다.'}</p><p id="assignment-message" class="assignment-message ${error ? 'is-error' : ''}" role="status" aria-live="polite">${esc(message || (selected ? '바꿀 두 번째 자리를 선택해 주세요.' : '첫 번째 자리를 선택해 주세요.'))}</p><div class="assignment-rounds">${rounds.map(round => {
      const matches = Object.entries(current.matchMap).filter(([, match]) => match.round === round).sort((a, b) => a[1].court - b[1].court);
      const active = matches.flatMap(([, match]) => [...match.teamA, ...match.teamB]);
      const rest = current.participantIds.filter(id => !active.includes(id));
      const [hour, minute] = current.startTime.split(':').map(Number), time = hour * 60 + minute + (round - 1) * current.roundMinutes;
      return `<section class="assignment-round"><h3>ROUND ${String(round).padStart(2, '0')} <span>${String(Math.floor(time / 60) % 24).padStart(2, '0')}:${String(time % 60).padStart(2, '0')}</span></h3><div class="assignment-matches">${matches.map(([matchId, match]) => `<article class="assignment-match"><h4>${match.court === 1 ? '안쪽' : '바깥쪽'} 코트</h4><div class="assignment-teams">${['teamA', 'teamB'].map((side, index) => `${index ? '<span class="assignment-vs">VS</span>' : ''}<div>${mode === 'team' ? button({ kind: 'team', matchId, side, playerIds: [...match[side]] }, match[side].map(id => labels[id]).join(' · ')) : match[side].map((playerId, index) => button({ kind: 'player', matchId, side, index, playerId }, labels[playerId])).join('')}${(current.lockedPairs || []).some(pair => pair.every(id => match[side].includes(id))) ? '<small>고정 페어</small>' : ''}</div>`).join('')}</div></article>`).join('')}</div>${rest.length ? `<div class="assignment-rest"><span>휴식</span><div>${rest.map(playerId => mode === 'player' ? button({ kind: 'rest', round, playerId }, labels[playerId]) : `<span>${esc(labels[playerId])}</span>`).join('')}</div></div>` : ''}</section>`;
    }).join('')}<div class="assignment-counts"><h3>수정 후 경기 수</h3><div>${Object.entries(games).map(([id, n]) => `<span>${esc(labels[id])} <strong>${n}경기</strong></span>`).join('')}</div>${notes.length ? `<ul>${notes.map(note => `<li>${esc(note)}</li>`).join('')}</ul>` : ''}</div></div><div class="assignment-footer"><p>적용 후 미리보기에서 확인하세요.<br>대진 확정·저장 전에는 공유되지 않습니다.</p><button type="button" id="assignment-apply" class="primary">수정 적용</button></div>`;
    dialog.querySelector('.assignment-rounds').scrollTop = scroll;
  }
  dialog.addEventListener('click', event => {
    const target = event.target.closest('button'); if (!target) return;
    if (target.id === 'assignment-close') { dialog.close(); return; }
    if (target.id === 'assignment-apply') {
      try { onApply(structuredClone(current)); dialog.close(); }
      catch (failure) { message = failure.message; error = true; render(); }
      return;
    }
    const focusId = target.id;
    if (target.dataset.mode) { mode = target.dataset.mode; selected = null; message = ''; error = false; }
    else if (target.id === 'assignment-undo' && stack.length) { current = stack.pop(); selected = null; message = '직전 수정으로 되돌렸습니다.'; error = false; }
    else if (target.id === 'assignment-reset') { current = structuredClone(original); stack = []; selected = null; message = '처음 대진으로 되돌렸습니다.'; error = false; }
    else if (target.dataset.slot) {
      const next = slots.get(target.dataset.slot); if (!next) return;
      error = false; message = '';
      if (!selected || slotKey(selected) === slotKey(next)) selected = selected ? null : next;
      else {
        try { const changed = swapAssignments(current, selected, next); stack.push(current); current = changed; selected = null; message = '자리를 바꿨습니다. 적용 전까지 되돌릴 수 있습니다.'; }
        catch (failure) { error = true; message = failure.message; }
      }
    }
    render();
    const focus = focusId ? dialog.querySelector(`#${focusId}`) : target.dataset.slot ? [...dialog.querySelectorAll('[data-slot]')].find(button => button.dataset.slot === target.dataset.slot) : [...dialog.querySelectorAll('[data-mode]')].find(button => button.dataset.mode === mode);
    focus?.focus({ preventScroll: true });
  });
  dialog.addEventListener('close', () => { dialog.remove(); document.body.classList.remove('manual-editor-open'); document.querySelector('#manual-schedule')?.focus(); });
  render(); document.body.append(dialog); document.body.classList.add('manual-editor-open'); dialog.showModal();
}
