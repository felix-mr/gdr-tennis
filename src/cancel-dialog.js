import { cancellationText } from './session-lifecycle.js';

export function openCancellation(session, completed, onConfirm) {
  if (document.querySelector('#cancel-dialog')) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'cancel-dialog'; dialog.className = 'cancel-dialog';
  const phrase = cancellationText(session.date);
  dialog.innerHTML = `<form><span class="cancel-eyebrow">대진 취소</span><h2 id="cancel-title"></h2><p class="cancel-warning">이 대진과 입력된 점수가 영구 삭제됩니다. 취소 후에는 복구할 수 없습니다.</p><p class="cancel-summary"></p><label for="cancel-confirmation">계속하려면 아래 문구를 그대로 입력해 주세요.</label><strong class="cancel-phrase"></strong><input id="cancel-confirmation" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="확인 문구 입력" aria-describedby="cancel-error"><p id="cancel-error" role="alert"></p><div class="cancel-actions"><button type="button" class="secondary" id="cancel-back">돌아가기</button><button type="submit" class="cancel-confirm" disabled>대진·점수 삭제</button></div></form>`;
  dialog.setAttribute('aria-labelledby', 'cancel-title');
  dialog.querySelector('h2').textContent = `${session.date} 대진을 취소할까요?`;
  dialog.querySelector('.cancel-summary').textContent = `전체 ${Object.keys(session.matchMap).length}경기 · 저장된 점수 ${completed}건`;
  dialog.querySelector('.cancel-phrase').textContent = phrase;
  const input = dialog.querySelector('input'), submit = dialog.querySelector('[type=submit]'), back = dialog.querySelector('#cancel-back'), error = dialog.querySelector('#cancel-error');
  let pending = false;
  input.addEventListener('input', () => { submit.disabled = pending || input.value !== phrase; error.textContent = input.value && input.value !== phrase ? '날짜와 띄어쓰기를 포함해 위 문구와 똑같이 입력해 주세요.' : ''; });
  back.addEventListener('click', () => { if (!pending) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
  dialog.addEventListener('close', () => { dialog.remove(); document.querySelector('#cancel-schedule')?.focus(); });
  dialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    if (pending || input.value !== phrase) { error.textContent = '확인 문구를 정확히 입력해 주세요.'; return; }
    pending = true; submit.disabled = true; back.disabled = true; input.disabled = true; submit.textContent = '취소 처리 중…';
    try { await onConfirm(input.value); dialog.close(); }
    catch (failure) { error.textContent = failure.message; }
    finally { pending = false; input.disabled = false; back.disabled = false; submit.disabled = input.value !== phrase; submit.textContent = '대진·점수 삭제'; }
  });
  document.body.append(dialog); dialog.showModal(); input.focus();
}
