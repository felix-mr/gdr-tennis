import { resultFor } from './session-lifecycle.js';
import { validResult } from './model.js';
import { sessionNames } from './guests.js';

const ROUNDS_PER_IMAGE = 8;
const FONT = '"Noto Sans KR", system-ui, sans-serif';
const COLORS = { green: '#672883', lime: '#dcea56', paper: '#faf8fc', text: '#34213f', muted: '#77837a', line: '#e7ddec' };

const clock = minutes => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export function scheduleImagePages(session, names, results = {}, saved = false) {
  names = sessionNames(session, names);
  const entries = Object.entries(session.matchMap).sort(([, a], [, b]) => a.round - b.round || a.court - b.court);
  const roundNumbers = [...new Set(entries.map(([, match]) => match.round))];
  const [hour, minute] = session.startTime.split(':').map(Number);
  const members = session.participantIds.map(id => ({ id, name: names[id], games: entries.filter(([, match]) => [...match.teamA, ...match.teamB].includes(id)).length })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const rounds = roundNumbers.map(round => {
    const matches = entries.filter(([, match]) => match.round === round);
    const active = new Set(matches.flatMap(([, match]) => [...match.teamA, ...match.teamB]));
    const start = hour * 60 + minute + (round - 1) * session.roundMinutes;
    return {
      number: round, start: clock(start), end: clock(start + session.roundMinutes),
      rests: members.filter(member => !active.has(member.id)).map(member => member.name),
      matches: matches.map(([id, match]) => {
        const result = resultFor({ results }, session, id);
        return { id, court: match.court, teamA: match.teamA.map(id => names[id]), teamB: match.teamB.map(id => names[id]), score: saved && validResult(result) ? [result.scoreA, result.scoreB] : null };
      }),
    };
  });
  const pageCount = Math.ceil(rounds.length / ROUNDS_PER_IMAGE);
  return Array.from({ length: pageCount }, (_, index) => ({
    date: session.date, saved, start: session.startTime, end: session.endTime || rounds.at(-1).end,
    matchCount: entries.length, members, page: index + 1, pageCount,
    rounds: rounds.slice(index * ROUNDS_PER_IMAGE, (index + 1) * ROUNDS_PER_IMAGE),
    filename: `GDR-${session.date}${pageCount > 1 ? `-${index + 1}` : ''}.png`,
  }));
}

function box(ctx, x, y, width, height, color, border = null, radius = 16) {
  ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fillStyle = color; ctx.fill();
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 2; ctx.stroke(); }
}
function text(ctx, value, x, y, size = 24, color = COLORS.text, weight = 500, align = 'left', maxWidth = Infinity) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  while (ctx.measureText(value).width > maxWidth && size > 16) ctx.font = `${weight} ${--size}px ${FONT}`;
  ctx.fillStyle = color; ctx.textAlign = align;
  if (Number.isFinite(maxWidth)) ctx.fillText(value, x, y, maxWidth); else ctx.fillText(value, x, y);
}

export async function renderScheduleImage(page) {
  const width = 1080, margin = 48, cardWidth = 482, roundHeight = 252;
  const memberRows = Math.ceil(page.members.length / 3);
  const footerY = 270 + page.rounds.length * roundHeight;
  const height = footerY + 110 + memberRows * 40 + 74;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지를 만들 수 없습니다. 다른 브라우저에서 다시 시도해 주세요.');
  ctx.fillStyle = COLORS.paper; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = COLORS.green; ctx.fillRect(0, 0, width, 224);
  text(ctx, 'GDR TENNIS CLUB', margin, 58, 26, COLORS.lime, 700);
  const weekday = new Intl.DateTimeFormat('ko-KR', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${page.date}T12:00:00Z`));
  text(ctx, `${page.date.replaceAll('-', '.')} (${weekday})`, margin, 128, 48, '#ffffff', 700);
  text(ctx, `${page.start}–${page.end}  ·  ${page.members.length}명  ·  ${page.matchCount}경기`, margin, 179, 25, '#d8e4d7');
  box(ctx, 878, 36, 154, 46, COLORS.lime, null, 23);
  text(ctx, page.saved ? '확정된 대진' : '미확정 대진', 955, 67, 20, COLORS.green, 700, 'center');
  if (page.pageCount > 1) text(ctx, `${page.page} / ${page.pageCount}`, 1032, 178, 24, '#d8e4d7', 500, 'right');

  page.rounds.forEach((round, index) => {
    const y = 270 + index * roundHeight;
    text(ctx, `ROUND ${String(round.number).padStart(2, '0')}`, margin, y, 20, COLORS.muted, 700);
    text(ctx, `${round.start}–${round.end}`, 214, y, 28, COLORS.green, 700);
    for (const court of [1, 2]) {
      const x = margin + (court - 1) * (cardWidth + 20), cardY = y + 18;
      const match = round.matches.find(match => match.court === court);
      box(ctx, x, cardY, cardWidth, 146, match ? '#ffffff' : '#eef1e6', COLORS.line);
      text(ctx, court === 1 ? '안쪽 코트' : '바깥쪽 코트', x + 22, cardY + 35, 22, COLORS.green, 700);
      if (!match) { text(ctx, '휴식', x + cardWidth / 2, cardY + 98, 27, COLORS.muted, 500, 'center'); continue; }
      text(ctx, match.teamA.join(' · '), x + 22, cardY + 86, 27, COLORS.text, 700, 'left', 196);
      text(ctx, 'VS', x + cardWidth / 2, cardY + 85, 16, COLORS.muted, 500, 'center');
      text(ctx, match.teamB.join(' · '), x + cardWidth - 22, cardY + 86, 27, COLORS.text, 700, 'right', 196);
      text(ctx, match.score ? `${match.score[0]} : ${match.score[1]}` : '— : —', x + cardWidth / 2, cardY + 125, 26, match.score ? COLORS.green : '#a3ad9b', 700, 'center');
    }
    text(ctx, round.rests.length ? `휴식  ${round.rests.join(' · ')}` : '휴식 없음', margin + 2, y + 198, 23, COLORS.muted, 500, 'left', width - margin * 2);
  });
  box(ctx, margin, footerY, width - margin * 2, 76 + memberRows * 40, '#edf2e7');
  text(ctx, '이번 모임 경기 수', margin + 24, footerY + 43, 23, COLORS.green, 700);
  page.members.forEach((member, index) => text(ctx, `${member.name}  ${member.games}경기`, margin + 24 + (index % 3) * 312, footerY + 86 + Math.floor(index / 3) * 40, 23, COLORS.text, 500, 'left', 290));
  text(ctx, '안쪽 · 바깥쪽 / 복식', margin, height - 30, 20, COLORS.muted);
  text(ctx, 'GDR', width - margin, height - 30, 22, COLORS.green, 700, 'right');
  const blob = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('이미지 생성에 실패했습니다. 다시 시도해 주세요.')), 'image/png'));
  canvas.width = 1; canvas.height = 1;
  return new File([blob], page.filename, { type: 'image/png' });
}

let dialog, images = [], current = 0, requestId = 0, opener, shareBundle = false;
const control = id => dialog.querySelector(`#${id}`);
function supportsShare(files) {
  try { return !!(navigator.share && navigator.canShare && navigator.canShare({ files: Array.isArray(files) ? files : [files] })); } catch { return false; }
}
function filesToShare() { const all = images.map(item => item.file); return shareBundle && supportsShare(all) ? all : [images[current].file]; }
function showPage() {
  const item = images[current];
  const img = document.createElement('img'); img.src = item.url; img.alt = item.page.title || `${item.page.date} GDR 대진표 ${item.page.page}장`; img.width = 1080;
  control('image-preview').replaceChildren(img);
  control('image-pager').hidden = images.length === 1;
  control('image-page-label').textContent = `${current + 1} / ${images.length}${item.page.label ? ` · ${item.page.label}` : ''}`;
  control('image-previous').disabled = current === 0; control('image-next').disabled = current === images.length - 1;
  control('image-download').disabled = false;
  const files = filesToShare();
  control('image-share').disabled = !supportsShare(files);
  control('image-share').textContent = files.length === 2 ? '두 장 함께 공유' : '이미지 공유';
  control('image-fallback').hidden = supportsShare(files);
  control('image-status').textContent = images.length > 1 ? `${images.length}장입니다. 각 이미지를 저장·공유해 주세요.` : '이미지를 길게 눌러 사진에 저장할 수 있습니다.';
  control('image-preview').setAttribute('aria-busy', 'false');
}
function createDialog() {
  dialog = document.createElement('dialog'); dialog.id = 'schedule-image-dialog'; dialog.setAttribute('aria-labelledby', 'image-title');
  dialog.innerHTML = `<div class="image-dialog-header"><h2 id="image-title">대진표 이미지</h2><button id="image-close" class="secondary" aria-label="이미지 미리보기 닫기">닫기</button></div><p id="image-status" role="status"></p><div id="image-preview" aria-busy="true"></div><div id="image-pager" class="image-pager" hidden><button id="image-previous" class="secondary">이전</button><span id="image-page-label"></span><button id="image-next" class="secondary">다음</button></div><div class="image-actions"><button id="image-download" class="secondary" disabled>파일 저장</button><button id="image-share" class="primary" disabled>이미지 공유</button></div><p id="image-fallback" hidden>이 브라우저는 이미지 공유를 지원하지 않습니다. 이미지를 저장한 뒤 카카오톡에 첨부해 주세요.</p>`;
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    requestId++; images.forEach(image => URL.revokeObjectURL(image.url)); images = [];
    document.body.classList.remove('image-dialog-open');
    control('image-preview').replaceChildren();
    (opener?.isConnected ? opener : document.querySelector('#export-image'))?.focus({ preventScroll: true });
  });
  dialog.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.id === 'image-close') { dialog.close(); return; }
    if (button.id === 'image-previous' || button.id === 'image-next') { current += button.id === 'image-next' ? 1 : -1; showPage(); return; }
    const item = images[current]; if (!item) return;
    if (button.id === 'image-download') {
      const link = document.createElement('a'); link.href = item.url; link.download = item.file.name; document.body.append(link); link.click(); link.remove();
      control('image-status').textContent = '사진에 저장하려면 이미지를 길게 누르세요. 파일은 다운로드 폴더에 저장됩니다.';
    }
    if (button.id === 'image-share') {
      button.disabled = true;
      try {
        // Files are prepared before this click so mobile user activation remains valid.
        await navigator.share({ files: filesToShare(), title: shareBundle ? control('image-title').textContent : item.page.title || `GDR ${item.page.date} 대진표` });
      } catch (error) {
        if (error.name !== 'AbortError') control('image-status').textContent = '공유하지 못했습니다. 이미지를 저장한 뒤 카카오톡에 첨부해 주세요.';
      } finally { if (dialog.open && images.length) button.disabled = !supportsShare(filesToShare()); }
    }
  });
}

export async function openScheduleImage(session, names, results, saved) {
  return openImagePages(scheduleImagePages(structuredClone(session), names, structuredClone(results), saved), renderScheduleImage, '대진표 이미지');
}

export async function openImagePages(pages, renderImage, title, bundle = false) {
  if (!pages.length) throw new Error('이미지로 저장할 기록이 없습니다.');
  if (!dialog) createDialog();
  images.forEach(image => URL.revokeObjectURL(image.url)); images = [];
  opener = document.activeElement;
  const version = ++requestId;
  current = 0; shareBundle = bundle;
  control('image-title').textContent = title;
  control('image-status').textContent = '이미지를 만들고 있습니다…';
  control('image-preview').innerHTML = '<p class="image-loading">잠시만 기다려 주세요.</p>';
  control('image-preview').setAttribute('aria-busy', 'true');
  control('image-pager').hidden = true; control('image-fallback').hidden = true;
  control('image-download').disabled = true; control('image-share').disabled = true;
  dialog.showModal();
  document.body.classList.add('image-dialog-open');
  try {
    await document.fonts.ready;
    for (const page of pages) {
      if (version !== requestId || !dialog.open) return;
      const file = await renderImage(page);
      if (version !== requestId || !dialog.open) return;
      images.push({ page, file, url: URL.createObjectURL(file) });
    }
    showPage();
  } catch {
    if (version !== requestId || !dialog.open) return;
    images.forEach(image => URL.revokeObjectURL(image.url)); images = [];
    control('image-preview').replaceChildren(); control('image-preview').setAttribute('aria-busy', 'false');
    control('image-status').textContent = '이미지를 만들지 못했습니다. 닫고 다시 시도해 주세요.';
  }
}
