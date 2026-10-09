import { nextSunday } from './model.js';
import { generationOf, resultFor } from './session-lifecycle.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const courtName = court => court === 1 ? '안쪽' : '바깥쪽';
export function defaultScheduleDate(sessions, today, preferred = '') {
  const dates = Object.keys(sessions).sort();
  return dates.includes(preferred) ? preferred : dates.find(date => date >= today) || nextSunday(today);
}
export function renderRounds({ session, state, names, editable = false, writable = false, dirty = new Map(), focusPlayer = '', controlPrefix = 'manage' }) {
  const labels = { ...names, ...Object.fromEntries(Object.entries(session.guests || {}).map(([id, guest]) => [id, guest.name])) };
  const entries = Object.entries(session.matchMap), rounds = [...new Set(entries.map(([, match]) => match.round))].sort((a, b) => a - b);
  const team = ids => ids.map(id => `<span class="team-player">${esc(labels[id] || id)}</span>`).join(' <span class="dot">·</span> ') + ((session.lockedPairs || []).some(pair => pair.every(id => ids.includes(id))) ? '<small class="team-pair-label">고정 페어</small>' : '');
  return rounds.map(round => {
    const allMatches = entries.filter(([, match]) => match.round === round), active = allMatches.flatMap(([, match]) => [...match.teamA, ...match.teamB]);
    const matches = focusPlayer ? allMatches.filter(([, match]) => [...match.teamA, ...match.teamB].includes(focusPlayer)) : allMatches;
    const [hour, minute] = session.startTime.split(':').map(Number), minutes = hour * 60 + minute + (round - 1) * session.roundMinutes;
    const time = `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    const rest = session.participantIds.filter(id => !active.includes(id)).map(id => esc(labels[id])).join(' · ') || '없음';
    return `<section class="round"><div class="round-header"><div><span>ROUND ${String(round).padStart(2, '0')}</span><strong>${time}</strong></div>${focusPlayer ? '' : `<p>휴식 <span>${rest}</span></p>`}</div><div class="match-grid">${matches.map(([id, match]) => {
      const result = resultFor(state, session, id), editing = dirty.get(`${session.date}_${id}`), pending = editing?.generation === generationOf(session) ? editing : undefined;
      const status = result ? result.outcome === 'draw' ? '무승부' : `${esc(labels[match[result.outcome][0]])} · ${esc(labels[match[result.outcome][1]])} 승` : '점수 미입력';
      const score = editable ? `<form class="score-form" data-match="${id}" data-date="${session.date}" data-generation="${generationOf(session)}"><div class="score-inputs"><label class="sr-only" for="${controlPrefix}-${id}-a">${esc(match.teamA.map(id => labels[id]).join(' · '))} 점수</label><input id="${controlPrefix}-${id}-a" name="scoreA" enterkeyhint="next" type="number" min="0" max="99" step="1" inputmode="numeric" placeholder="—" value="${esc(pending?.scoreA ?? result?.scoreA ?? '')}" required><span>:</span><label class="sr-only" for="${controlPrefix}-${id}-b">${esc(match.teamB.map(id => labels[id]).join(' · '))} 점수</label><input id="${controlPrefix}-${id}-b" name="scoreB" enterkeyhint="done" type="number" min="0" max="99" step="1" inputmode="numeric" placeholder="—" value="${esc(pending?.scoreB ?? result?.scoreB ?? '')}" required></div><div class="score-footer"><span>${status}</span><button type="submit" class="text-button" ${!writable ? 'disabled' : ''}>${result ? '점수 수정' : '점수 저장'}</button></div></form>` : `<div class="viewer-score"><strong>${result?.scoreA ?? '—'}</strong><span>:</span><strong>${result?.scoreB ?? '—'}</strong></div><p class="viewer-score-status">${status}</p>`;
      return `<article class="match"><div class="match-header"><span><i></i> ${courtName(match.court)} 코트</span><span class="match-type">복식</span></div><div class="teams"><div>${team(match.teamA)}</div><span class="versus">VS</span><div>${team(match.teamB)}</div></div>${editable || state.sessions[session.date] ? score : '<div class="preview-note">대진 확정 후 점수 입력</div>'}</article>`;
    }).join('')}${!matches.length ? `<div class="idle-court viewer-rest">${esc(labels[focusPlayer])} · 이번 라운드 휴식</div>` : !focusPlayer && allMatches.length === 1 ? `<div class="idle-court">${courtName(allMatches[0][1].court === 1 ? 2 : 1)} 코트 · 휴식</div>` : ''}</div></section>`;
  }).join('');
}
