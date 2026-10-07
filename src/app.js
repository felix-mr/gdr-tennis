import './style.css';
import playerData from '../data/players.json';
const players = [...playerData].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
import periods from '../data/periods.json';
import baseline from '../data/strength-baseline.json';
import { koreaToday, nextSunday, quarter, recordsFrom, ranking, outcome } from './model.js';
import { allocateForWindow, generateSchedule } from './scheduler.js';
import { strengthsForSession } from './ratings.js';
import { createStore, firebaseConfigured } from './store.js';
const courtName = court => court === 1 ? '안쪽' : '바깥쪽';
const $ = selector => document.querySelector(selector);
const names = Object.fromEntries(players.map(p => [p.id, p.name]));
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const team = ids => ids.map(id => esc(names[id] || id)).join(' <span class="dot">·</span> ');
let state = { schemaVersion: 1, sessions: {}, results: {} }, draft = null, store, writable = false;
let hasSnapshot = false;
let lockedPairs = [], prepSelection = new Set();
try { const pairs = JSON.parse(localStorage.getItem('gdr-prep-pairs') || '[]'); const all = pairs.flat(); if (pairs.every(pair => pair.length === 2 && pair.every(id => names[id])) && new Set(all).size === all.length) lockedPairs = pairs; } catch {}
let tab = 'schedule', selected = new Set(players.map(p => p.id)), date = nextSunday(koreaToday()), filter = quarter(koreaToday()), playerFilter = '', dirty = new Map();
const roundMinutes = 30, startTime = '19:00', endTime = '21:00';
let status = firebaseConfigured ? '공유 기록 연결 중…' : '로컬 기록 불러오는 중…';
const initialQuarter = quarter(koreaToday());
$('#app').innerHTML = `
<header><a class="brand" href="#" aria-label="GDR 홈"><span class="brand-mark">G<span class="ball"></span></span><span>GDR <small>TENNIS CLUB</small></span></a><span class="season">${initialQuarter.replace('-Q', ' · Q')}</span></header>
<main><div class="page-head"><div><p class="eyebrow">OUR COURT, OUR GAME</p><h1>함께 치고,<br class="mobile-only"> 기록은 차곡차곡.</h1><p class="subtitle">매주 일요일 19:00–21:00 · 두 코트에서 함께.</p></div><div class="club-stamp"><strong>14</strong><span>고정 멤버 · 복식</span></div></div>
<nav class="tabs" aria-label="화면 선택"><button data-tab="schedule" aria-selected="true">대진표</button><button data-tab="ranking" aria-selected="false">순위 · 기록</button><button data-tab="prep" aria-selected="false">대회 준비</button><button data-tab="members" aria-selected="false">멤버</button></nav>
<div class="connection"><span class="status-dot"></span><span id="connection-status" role="status"></span></div>
<section id="schedule-view">
<div class="section-heading"><div><h2>오늘의 대진</h2><p>참석자를 고르고, 두 코트에 공평하게.</p></div><label class="date-control">모임 날짜<input id="date" type="date" value="${date}" required></label></div>
<div class="builder" id="builder"><div class="panel-top"><h3>참석 멤버 <span id="selected-count"></span></h3><button id="select-all" class="text-button">전체 해제</button></div><div class="player-grid" id="attendees"></div>
<div class="session-settings"><div class="time-setting"><span class="setting-label">모임 시간</span><div class="time-range"><label><span>시작</span><strong>19:00</strong></label><span class="range-arrow">→</span><label><span>종료</span><strong>21:00</strong></label></div></div><div class="court-info"><span class="court-icon" aria-hidden="true"></span><div><strong>2면</strong><span>복식 · 30분 고정</span></div></div></div>
<div class="builder-bottom"><p>참석 인원·모임 시간에 맞춰 2~4경기 자동 배정.<br>추가 경기는 누적 경기 수가 적은 멤버 우선.</p><button id="generate" class="primary">대진 만들기 <span>↗</span></button></div></div>
<button id="prep-shortcut" data-tab="prep" class="prep-shortcut">대회 준비 페어 설정 →</button><div id="schedule-content"></div></section>
<section id="ranking-view" hidden><div class="section-heading"><div><h2>우리의 스코어보드</h2><p>승점은 쌓이고, 기록은 남고.</p></div><label class="period-control"><span>조회 기간</span><select id="period"></select></label></div><div id="ranking-summary" class="summary-grid"></div><div class="rank-panel"><div class="panel-top"><h3 id="ranking-title"></h3><button id="export-csv" class="text-button">CSV 내려받기 ↓</button></div><div class="table-scroll"><table><caption class="sr-only">GDR 개인 순위</caption><thead><tr><th>순위</th><th>이름</th><th>승점</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>승률</th><th>득</th><th>실</th><th>득실차</th></tr></thead><tbody id="rankings"></tbody></table></div><p class="table-note">승 3점 · 무 1점 · 패 0점 / 같은 승점은 공동순위 / 승률 = 승 ÷ 전체 경기</p></div><div class="section-heading history-head"><h3>경기 기록</h3><label class="sr-only" for="player-filter">선수</label><select id="player-filter"><option value="">전체 멤버</option>${players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div><div id="history"></div></section>
<section id="prep-view" hidden><div class="section-heading"><div><h2>같이 나갈 우리 조</h2><p>대회를 준비하는 두 멤버를 페어로 등록해 주세요.</p></div></div><div class="prep-editor"><div class="panel-top"><h3>멤버 두 명 선택</h3><span id="prep-selection-count">0 / 2</span></div><div id="prep-candidates" class="prep-candidates"></div><div class="prep-selection-footer"><p id="prep-selection-label">함께할 두 멤버를 선택해 주세요.</p><button id="add-prep-pair" class="primary" disabled>페어 등록</button></div></div><div class="section-heading prep-list-heading"><h3>등록된 페어 <span id="prep-pair-count">0조</span></h3><p>함께 참석하면 같은 팀으로 출전합니다.</p></div><div id="prep-pairs" class="prep-pairs"></div><p class="prep-footnote">한 멤버는 한 페어에 등록 가능. 한 명이 불참하면 해당 모임에는 적용하지 않습니다.</p></section>
<section id="members-view" hidden><div class="section-heading"><div><h2>같은 코트, 열네 명</h2><p>2026년 4분기 고정 멤버. 전원 같은 복식 풀로 배정.</p></div></div><div class="gender-legend"><span><i class="male-dot"></i>남성</span><span><i class="female-dot"></i>여성</span></div><div class="member-grid">${players.map((p, i) => `<article class="member ${p.gender}"><span class="member-number">${String(i + 1).padStart(2, '0')}</span><strong>${esc(p.name)}<span class="sr-only">${p.gender === 'female' ? '여성' : '남성'}</span></strong><span>고정 멤버</span></article>`).join('')}</div><div class="backup-panel"><div><h3>기록 보관</h3><p>로컬 기록은 이 브라우저에 저장됩니다. 백업 파일로 보관해 주세요.</p></div><div class="backup-actions"><button id="backup" class="secondary">백업 내려받기</button>${!firebaseConfigured ? '<label class="secondary file-label">백업 가져오기<input id="import" type="file" accept="application/json,.json"></label>' : ''}</div></div></section>
<footer><span>GDR TENNIS CLUB</span><span>매 경기, 함께 쌓는 기록.</span></footer></main><div id="toast" role="status" aria-live="polite" hidden></div>`;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').hidden = true, 5500); }
function renderAttendees() {
  $('#attendees').innerHTML = players.map(p => `<label class="player-chip ${p.gender} ${selected.has(p.id) ? 'checked' : ''}"><input type="checkbox" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}><span class="chip-name ${p.gender}">${esc(p.name)}<span class="sr-only">${p.gender === 'female' ? '여성' : '남성'}</span></span><span class="checkmark">✓</span></label>`).join('');
  $('#selected-count').textContent = `${selected.size}명`; $('#select-all').textContent = selected.size === players.length ? '전체 해제' : '전체 선택';
  renderPrep();
}
function updateConnection() { $('#connection-status').textContent = status; document.querySelector('.status-dot').classList.toggle('connected', writable); }
function currentTotals() {
  return Object.fromEntries(ranking(recordsFrom(state).filter(r => quarter(r.date) === quarter(date) && r.date < date), players).map(r => [r.id, r.games]));
}
function renderSchedule() {
  const session = state.sessions[date] || draft;
  $('#builder').hidden = !!state.sessions[date];
  const content = $('#schedule-content');
  if (!session) { content.innerHTML = '<div class="empty"><span class="court-drawing" aria-hidden="true"></span><h3>오늘 함께할 멤버를 골라 주세요.</h3><p>대진을 만들면 개인별 경기 수와 쉬는 라운드를 확인할 수 있어요.</p></div>'; return; }
  const saved = !!state.sessions[date], entries = Object.entries(session.matchMap), completed = entries.filter(([id]) => state.results[`${date}_${id}`]).length;
  const rounds = [...new Set(entries.map(([, m]) => m.round))].sort((a, b) => a - b);
  const counts = Object.fromEntries(session.participantIds.map(id => [id, entries.filter(([, m]) => [...m.teamA, ...m.teamB].includes(id)).length]));
  const prepExceptions = (session.lockedPairs || []).reduce((sum, [a, b]) => sum + counts[a] - entries.filter(([, m]) => [m.teamA, m.teamB].some(team => team.includes(a) && team.includes(b))).length, 0);
  content.innerHTML = `<div class="schedule-meta"><div><span class="label-tag">${saved ? '저장된 대진' : '대진 미리보기'}</span><strong>${entries.length}경기 · ${rounds.length}라운드</strong><span>${completed}/${entries.length} 점수 입력</span></div><div>${saved ? '<button class="secondary" id="print">인쇄</button>' : `<button class="secondary" id="regenerate">다시 배정</button><button class="primary" id="save-schedule" ${!writable ? 'disabled' : ''}>대진 확정·저장</button>`}</div></div>
<div class="allocation"><div class="panel-top"><h3>개인별 경기 수</h3><span>분기 누적 → 이번 모임</span></div><div class="allocation-grid">${session.participantIds.map(id => `<label><span>${esc(names[id])}<small>누적 ${currentTotals()[id] || 0}경기</small></span>${saved ? `<strong>${counts[id]}경기</strong>` : `<select data-quota="${id}" aria-label="${esc(names[id])} 경기 수">${[2, 3, 4].map(n => `<option value="${n}" ${counts[id] === n ? 'selected' : ''}>${n}경기</option>`).join('')}</select>`}</label>`).join('')}</div>${!saved ? '<p class="hint">개인 경기 수를 바꾸면 다시 배정됩니다. 총합은 4의 배수여야 합니다.</p><button id="apply-quotas" class="text-button">경기 수 조정 적용 →</button>' : ''}${session.lockedPairs?.length ? `<p class="hint">대회 준비 페어 ${session.lockedPairs.length}조 적용${prepExceptions ? ` · 참석 인원상 ${prepExceptions}회는 다른 파트너로 출전` : ''}</p>` : ''}${session.partnerRepeats ? `<p class="hint">같은 파트너 ${session.partnerRepeats}회 반복. 참가 인원·경기 수에 따른 배정입니다.</p>` : '<p class="hint">같은 파트너 중복 없이 배정.</p>'}</div>
${rounds.map(round => {
  const matches = entries.filter(([, m]) => m.round === round), active = matches.flatMap(([, m]) => [...m.teamA, ...m.teamB]);
  const [hour, minute] = session.startTime.split(':').map(Number), minutes = hour * 60 + minute + (round - 1) * session.roundMinutes;
  const time = `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return `<section class="round"><div class="round-header"><div><span>ROUND ${String(round).padStart(2, '0')}</span><strong>${time}</strong></div><p>휴식 <span>${session.participantIds.filter(id => !active.includes(id)).map(id => esc(names[id])).join(' · ') || '없음'}</span></p></div><div class="match-grid">${matches.map(([id, m]) => {
    const result = state.results[`${date}_${id}`], pending = dirty.get(`${date}_${id}`);
    return `<article class="match"><div class="match-header"><span><i></i> ${courtName(m.court)} 코트</span><span class="match-type">복식</span></div><div class="teams"><div>${team(m.teamA)}</div><span class="versus">VS</span><div>${team(m.teamB)}</div></div>${saved ? `<form class="score-form" data-match="${id}"><div class="score-inputs"><label class="sr-only" for="${id}-a">${m.teamA.map(id => names[id]).join(' · ')} 점수</label><input id="${id}-a" name="scoreA" type="number" min="0" max="99" step="1" inputmode="numeric" placeholder="—" value="${esc(pending?.scoreA ?? result?.scoreA ?? '')}" required><span>:</span><label class="sr-only" for="${id}-b">${m.teamB.map(id => names[id]).join(' · ')} 점수</label><input id="${id}-b" name="scoreB" type="number" min="0" max="99" step="1" inputmode="numeric" placeholder="—" value="${esc(pending?.scoreB ?? result?.scoreB ?? '')}" required></div><div class="score-footer"><span>${result ? result.outcome === 'draw' ? '무승부' : `${esc(names[m[result.outcome][0]])} · ${esc(names[m[result.outcome][1]])} 승` : '점수 미입력'}</span><button type="submit" class="text-button" ${!writable ? 'disabled' : ''}>${result ? '점수 수정' : '점수 저장'}</button></div></form>` : '<div class="preview-note">대진 확정 후 점수 입력</div>'}</article>`;
  }).join('')}${matches.length === 1 ? '<div class="idle-court">바깥쪽 코트 · 휴식</div>' : ''}</div></section>`;
}).join('')}`;
}
function periodLabel(value) { return value === 'all' ? '전체 누적' : value.includes('-Q') ? value.replace('-Q', '년 ') + '분기' : value; }
function scopedRecords() { return recordsFrom(state).filter(r => filter === 'all' || (filter.includes('-Q') ? quarter(r.date) === filter : r.date === filter)); }
function renderRanking() {
  const years = [...new Set([koreaToday().slice(0, 4), ...Object.keys(state.sessions).map(date => date.slice(0, 4)), ...periods.map(p => p.id.slice(0, 4)), ...(baseline.sourcePeriod ? [baseline.sourcePeriod.slice(0, 4)] : [])])];
  const values = years.flatMap(year => [1, 2, 3, 4].map(q => `${year}-Q${q}`)).sort().reverse();
  $('#period').innerHTML = `<option value="all">전체 누적</option><optgroup label="분기별">${values.map(v => `<option value="${v}">${periodLabel(v)}</option>`).join('')}</optgroup><optgroup label="모임별">${Object.keys(state.sessions).sort().reverse().map(d => `<option value="${d}">${d}</option>`).join('')}</optgroup>`;
  $('#period').value = filter;
  if (!hasSnapshot) {
    $('#ranking-title').textContent = `${periodLabel(filter)} 순위`;
    $('#ranking-summary').innerHTML = '';
    $('#rankings').innerHTML = '<tr><td colspan="11" class="records-pending">공유 기록에 연결하면 순위를 표시합니다.</td></tr>';
    $('#history').innerHTML = '<div class="empty compact"><h3>기록 연결을 기다리고 있어요.</h3><p>연결 상태를 확인해 주세요. 아직 기록을 불러오지 못했습니다.</p></div>';
    $('#export-csv').disabled = true;
    return;
  }
  $('#export-csv').disabled = false;
  const records = scopedRecords(), rows = ranking(records, players), participating = rows.filter(r => r.games).length;
  $('#ranking-title').textContent = `${periodLabel(filter)} 순위`;
  $('#ranking-summary').innerHTML = [['완료 경기', records.length, '경기'], ['기록된 모임', new Set(records.map(r => r.date)).size, '회'], ['경기한 멤버', participating, '명']].map(([label, n, unit]) => `<div><span>${label}</span><strong>${n}<small>${unit}</small></strong></div>`).join('');
  $('#rankings').innerHTML = rows.map(r => `<tr class="${r.rank === 1 ? 'first' : ''}"><td>${r.rank ?? '—'}</td><td><button class="name-button" data-player="${r.id}">${esc(r.name)}</button></td><td class="points">${r.points}</td><td>${r.games}</td><td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td><td>${r.winRate === null ? '—' : r.winRate + '%'}</td><td>${r.scored}</td><td>${r.conceded}</td><td>${r.difference > 0 ? '+' : ''}${r.difference}</td></tr>`).join('');
  const games = records.filter(r => !playerFilter || [...r.teamA, ...r.teamB].includes(playerFilter)).sort((a, b) => b.date.localeCompare(a.date) || a.round - b.round || a.court - b.court);
  $('#player-filter').value = playerFilter;
  $('#history').innerHTML = games.length ? games.map(r => `<article class="history-card"><span>${r.date} · ${r.round}라운드 · ${courtName(r.court)} 코트</span><div>${team(r.teamA)} <strong>${r.scoreA} : ${r.scoreB}</strong> ${team(r.teamB)}</div><button class="text-button" data-open-date="${r.date}">대진표 보기 →</button></article>`).join('') : '<div class="empty compact"><h3>아직 저장된 경기 결과가 없어요.</h3><p>대진표에서 점수를 저장하면 순위와 기록이 반영됩니다.</p></div>';
}
function renderPrep() {
  const used = new Set(lockedPairs.flat());
  $('#prep-candidates').innerHTML = players.map(p => `<button class="prep-candidate ${p.gender} ${prepSelection.has(p.id) ? 'selected' : ''}" data-prep-player="${p.id}" aria-pressed="${prepSelection.has(p.id)}" ${used.has(p.id) || (prepSelection.size === 2 && !prepSelection.has(p.id)) ? 'disabled' : ''}><span>${esc(p.name)}</span><small>${used.has(p.id) ? '등록됨' : prepSelection.has(p.id) ? '선택됨' : '+'}</small></button>`).join('');
  $('#prep-selection-count').textContent = `${prepSelection.size} / 2`;
  $('#prep-selection-label').textContent = prepSelection.size ? [...prepSelection].map(id => names[id]).join(' · ') : '함께할 두 멤버를 선택해 주세요.';
  $('#add-prep-pair').disabled = prepSelection.size !== 2;
  $('#prep-pair-count').textContent = `${lockedPairs.length}조`;
  $('#prep-pairs').innerHTML = lockedPairs.length ? lockedPairs.map((pair, index) => `<article class="prep-pair-card"><span class="prep-pair-number">${String(index + 1).padStart(2, '0')}</span><div><strong>${esc(names[pair[0]])}<span>·</span>${esc(names[pair[1]])}</strong><small>${pair.every(id => selected.has(id)) ? '이번 모임에 함께 참석' : '이번 모임에 한 명 이상 불참'}</small></div><button data-remove-prep="${index}" class="text-button" aria-label="${pair.map(id => esc(names[id])).join(' · ')} 페어 해제">해제</button></article>`).join('') : '<div class="prep-empty">등록된 페어가 없습니다.<br><span>위에서 두 멤버를 선택해 첫 페어를 만들어 주세요.</span></div>';
  $('#prep-shortcut').textContent = lockedPairs.length ? `대회 준비 페어 ${lockedPairs.length}조 · 설정 →` : '대회 준비 페어 설정 →';
}
function render() { updateConnection(); renderSchedule(); renderRanking(); renderPrep(); }
function switchTab(value) { tab = value; document.querySelectorAll('[data-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.tab === tab))); for (const name of ['schedule', 'ranking', 'prep', 'members']) $(`#${name}-view`).hidden = name !== tab; }
function build(quotas) {
  if (!$('#date').value) throw new Error('날짜와 시작 시간을 입력해 주세요.');
  const ids = [...selected];
  const minutes = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  const windowRounds = (minutes(endTime) - minutes(startTime)) / roundMinutes;
  const activePairs = lockedPairs.filter(pair => pair.every(id => ids.includes(id)));
  quotas ??= allocateForWindow(ids, windowRounds, currentTotals(), activePairs);
  const strengths = strengthsForSession(recordsFrom(state), players.map(p => p.id), baseline, date);
  const result = generateSchedule(ids, quotas, { strengths, lockedPairs: activePairs });
  if (Math.max(...Object.values(result.matchMap).map(m => m.round)) > windowRounds) throw new Error('조정한 경기 수를 모임 시간 안에 배정할 수 없습니다. 종료 시간을 늘리거나 경기 수를 줄여 주세요.');
  draft = { schemaVersion: 1, date, participantIds: ids, fixedPlayerIds: ids, startTime, roundMinutes, endTime, matchMap: result.matchMap, partnerRepeats: result.partnerRepeats, lockedPairs: activePairs };
  renderSchedule();
}
function download(content, filename, type) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
$('#app').addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  try {
    if (button.dataset.tab) switchTab(button.dataset.tab);
    else if (button.dataset.prepPlayer) {
      const id = button.dataset.prepPlayer;
      if (prepSelection.has(id)) prepSelection.delete(id); else if (prepSelection.size < 2) prepSelection.add(id);
      renderPrep();
    } else if (button.id === 'add-prep-pair' && prepSelection.size === 2) {
      lockedPairs.push([...prepSelection]); prepSelection.clear(); localStorage.setItem('gdr-prep-pairs', JSON.stringify(lockedPairs)); draft = null; render(); toast('대회 준비 페어를 등록했습니다.');
    } else if (button.dataset.removePrep !== undefined) {
      lockedPairs.splice(Number(button.dataset.removePrep), 1); localStorage.setItem('gdr-prep-pairs', JSON.stringify(lockedPairs)); draft = null; render(); toast('페어를 해제했습니다.');
    }
    else if (button.id === 'select-all') { selected = new Set(selected.size === players.length ? [] : players.map(p => p.id)); draft = null; renderAttendees(); renderSchedule(); }
    else if (button.id === 'generate' || button.id === 'regenerate') { build(); toast('대진을 만들었습니다. 경기 수 확인 후 확정해 주세요.'); }
    else if (button.id === 'apply-quotas') { build(Object.fromEntries([...document.querySelectorAll('[data-quota]')].map(select => [select.dataset.quota, Number(select.value)]))); toast('개인 경기 수를 반영했습니다.'); }
    else if (button.id === 'save-schedule') { if (!store?.canWrite) throw new Error('저장 연결 상태를 확인해 주세요.'); button.disabled = true; await store.saveSession(draft); draft = null; renderSchedule(); toast('대진 저장 완료. 점수를 입력할 수 있습니다.'); }
    else if (button.id === 'print') window.print();
    else if (button.dataset.player) { playerFilter = button.dataset.player; renderRanking(); $('#history').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    else if (button.dataset.openDate) { date = button.dataset.openDate; $('#date').value = date; draft = null; renderSchedule(); switchTab('schedule'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (button.id === 'backup') download(JSON.stringify(state, null, 2), `gdr-backup-${koreaToday()}.json`, 'application/json');
    else if (button.id === 'export-csv') {
      const rows = ranking(scopedRecords(), players);
      const columns = ['rank', 'name', 'points', 'games', 'wins', 'draws', 'losses', 'winRate', 'scored', 'conceded', 'difference'];
      const csv = [['순위', '이름', '승점', '경기수', '승', '무', '패', '승률', '득', '실', '득실차'], ...rows.map(r => columns.map(c => r[c] ?? ''))].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
      download('\uFEFF' + csv, `gdr-${filter}.csv`, 'text/csv;charset=utf-8');
    }
  } catch (error) { toast(error.message); button.disabled = false; }
});
$('#app').addEventListener('change', async event => {
  const input = event.target;
  if (input.dataset.quota) {
    const pair = lockedPairs.find(pair => pair.includes(input.dataset.quota));
    const partner = pair?.find(id => id !== input.dataset.quota);
    const control = partner && document.querySelector(`[data-quota="${partner}"]`);
    if (control) control.value = input.value;
  }
  else if (input.closest('#attendees')) { if (input.checked) selected.add(input.value); else selected.delete(input.value); draft = null; renderAttendees(); renderSchedule(); }
  else if (input.id === 'date') { date = input.value; draft = null; dirty.clear(); renderSchedule(); }
  else if (['start', 'end'].includes(input.id)) { draft = null; renderSchedule(); }
  else if (input.id === 'period') { filter = input.value; renderRanking(); }
  else if (input.id === 'player-filter') { playerFilter = input.value; renderRanking(); }
  else if (input.id === 'import' && input.files[0]) {
    try { const text = await input.files[0].text(); const parsed = JSON.parse(text); if (!confirm(`${Object.keys(parsed.sessions || {}).length}개 모임을 가져옵니다. 같은 날짜가 있으면 가져오기를 중단합니다.`)) return; await store.importBackup(text); toast('백업 가져오기 완료.'); } catch (error) { toast(error.message); } input.value = '';
  }
});
$('#app').addEventListener('input', event => {
  const form = event.target.closest('[data-match]');
  if (form) { const key = `${date}_${form.dataset.match}`, prior = dirty.get(key); dirty.set(key, { scoreA: form.scoreA.value, scoreB: form.scoreB.value, revision: prior?.revision ?? state.results[key]?.revision ?? 0 }); }
});
$('#app').addEventListener('submit', async event => {
  const form = event.target.closest('[data-match]'); if (!form) return; event.preventDefault();
  const button = form.querySelector('button'); button.disabled = true;
  try {
    const scoreA = Number(form.scoreA.value), scoreB = Number(form.scoreB.value), key = `${date}_${form.dataset.match}`, revision = dirty.get(key)?.revision ?? state.results[key]?.revision ?? 0;
    await store.saveResult(date, form.dataset.match, { scoreA, scoreB, outcome: outcome(scoreA, scoreB) }, revision);
    dirty.delete(key); render(); toast('점수 저장 완료. 순위에 반영했습니다.');
  } catch (error) { toast(error.message); button.disabled = false; }
});
renderAttendees(); render();
try { store = await createStore(next => { state = next; hasSnapshot = true; render(); }, (text, canWrite) => { status = text; writable = canWrite; render(); }); }
catch (error) { status = error.message; writable = false; updateConnection(); }
window.addEventListener('offline', () => { if (firebaseConfigured) { writable = false; status = '인터넷 연결 끊김 · 입력값은 유지됩니다'; updateConnection(); renderSchedule(); } });
window.addEventListener('online', () => { if (firebaseConfigured) { writable = store?.canWrite || false; status = '공유 기록 다시 연결 중'; updateConnection(); renderSchedule(); } });
