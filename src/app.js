import './style.css';
import './theme.css';
import { setupTheme } from './theme.js';
import { mountArchiveView } from './archive-view.js';
import { datedHistory, historicalPlayers, rankingWithHistory } from './history-stats.js';
import playerData from '../data/players.json';
const players = [...playerData].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
import periods from '../data/periods.json';
import baseline from '../data/strength-baseline.json';
import { koreaToday, nextSunday, quarter, recordsFrom, outcome, meetingWindow, validDate } from './model.js';
import { allocateForWindow, generateSchedule } from './scheduler.js';
import { strengthsForSession } from './ratings.js';
import { createStore, firebaseConfigured } from './store.js';
import { openScheduleImage } from './schedule-image.js';
import { membersForPeriod } from './roster.js';
import { GUEST_IDS, GUEST_STRENGTH, normalizeGuestName, validateGuests, sessionNames } from './guests.js';
import { withinPeriod, periodLabel, quarterBounds, halfYear } from './periods.js';
import { openRecordImages } from './record-image.js';
import { matchesPlayer, matchesRecord } from './search.js';
import { mountPersonalView } from './personal-view.js';
import { readHistory } from './history-store.js';
import { generationOf, resultFor } from './session-lifecycle.js';
import { openCancellation } from './cancel-dialog.js';
const courtName = court => court === 1 ? '안쪽' : '바깥쪽';
const $ = selector => document.querySelector(selector);
const names = Object.fromEntries(players.map(p => [p.id, p.name]));
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const team = (ids, profiles = state.sessions[date]?.guests || guests) => { const labels = sessionNames({ guests: profiles }, names); return ids.map(id => `<span class="team-player">${esc(labels[id] || id)}</span>`).join(' <span class="dot">·</span> '); };
let state = { schemaVersion: 1, sessions: {}, results: {} }, draft = null, store, writable = false, historySets = [];
let hasSnapshot = false;
let lockedPairs = [], prepSelection = new Set();
try { const pairs = JSON.parse(localStorage.getItem('gdr-prep-pairs') || '[]'); const all = pairs.flat(); if (pairs.every(pair => pair.length === 2 && pair.every(id => names[id])) && new Set(all).size === all.length) lockedPairs = pairs; } catch {}
let tab = 'schedule', date = nextSunday(koreaToday()), filter = quarter(koreaToday()), playerFilter = '', dirty = new Map(), memberPeriod = 'all';
let selected = new Set(membersForPeriod(date, players, periods).map(p => p.id));
let guests = {};
let search = '', rangeStart = quarterBounds(quarter(koreaToday())).start, rangeEnd = koreaToday();
const roundMinutes = 30;
let startTime = '19:00', endTime = '21:00';
const timeOptions = selectedTime => Array.from({ length: 48 }, (_, i) => {
  const time = `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`;
  return `<option value="${time}" ${selectedTime === time ? 'selected' : ''}>${time}</option>`;
}).join('');
let status = firebaseConfigured ? '공유 기록 연결 중…' : '로컬 기록 불러오는 중…';
const initialQuarter = quarter(koreaToday());
let imagePeriod = halfYear(koreaToday());
$('#app').innerHTML = `
<header><a class="brand" href="#" aria-label="GDR 홈"><span class="brand-logo"><img src="${import.meta.env.BASE_URL}gdr-logo.png" alt=""></span><span>GDR TENNIS<small>EST 2022</small></span></a><div class="header-actions"><span class="season">${initialQuarter.replace('-Q', ' · Q')}</span><button id="theme-toggle" class="theme-toggle" type="button" aria-label="화면 모드 변경"></button></div></header>
<main><nav class="tabs" aria-label="화면 선택"><button data-tab="schedule" aria-selected="true">대진표</button><button data-tab="ranking" aria-selected="false">순위 · 기록</button><button data-tab="personal" aria-selected="false">개인 기록</button><button data-tab="prep" aria-selected="false">대회 준비</button><button data-tab="members" aria-selected="false">멤버</button></nav>
<div class="page-head"><div><p class="eyebrow">OUR COURT, OUR GAME</p><h1>함께 치고,<br class="mobile-only"> 기록은 차곡차곡.</h1><p class="subtitle">매주 일요일 · 기본 19:00–21:00 · 두 코트에서 함께.</p></div><div class="club-stamp"><strong>${players.length}</strong><span>전체 멤버 · 복식</span></div></div>
<div class="connection"><span class="status-dot"></span><span id="connection-status" role="status"></span></div>
<section id="schedule-view">
<div class="section-heading"><div><h2>오늘의 대진</h2><p>참석자를 고르고, 두 코트에 공평하게.</p></div><label class="date-control">모임 날짜<input id="date" type="date" value="${date}" required></label></div>
<div class="builder" id="builder"><div class="panel-top"><h3>참석 멤버 <span id="selected-count"></span></h3><button id="select-all" class="text-button">전체 해제</button></div><p id="roster-note" class="hint" hidden></p><div class="player-grid" id="attendees"></div>
<div class="guest-section"><div class="panel-top"><h3>게스트 <span id="guest-count">0명</span></h3><button id="add-guest" class="secondary" aria-expanded="false" aria-controls="guest-editor">게스트 +</button></div><div id="guest-editor" hidden><form id="guest-form" class="guest-form"><label class="sr-only" for="guest-name">게스트 이름</label><input id="guest-name" name="guestName" type="text" maxlength="12" placeholder="게스트 이름" required autocomplete="off" enterkeyhint="done"><button class="primary" type="submit">추가</button><button id="cancel-guest" class="text-button" type="button">취소</button></form></div><div id="guests" class="guest-grid"></div><p class="hint">함께 경기할 게스트의 이름을 입력해 주세요. 회원 순위에는 포함되지 않습니다.</p></div>
<div class="session-settings"><div class="time-setting"><span class="setting-label">모임 시간</span><div class="time-range"><label><span>시작</span><select id="start" aria-label="모임 시작 시간">${timeOptions(startTime)}</select></label><span class="range-arrow">→</span><label><span>종료</span><select id="end" aria-label="모임 종료 시간">${timeOptions(endTime)}</select></label></div><div class="time-presets" role="group" aria-label="자주 쓰는 모임 시간"><button data-meeting-time="19:00/21:00" aria-pressed="true">19:00–21:00</button><button data-meeting-time="19:00/22:00" aria-pressed="false">19:00–22:00</button></div><p class="time-hint">24시간 표기 · 30분 단위 · 같은 날 기준</p></div><div class="court-info"><span class="court-icon" aria-hidden="true"></span><div><strong>2면</strong><span>복식 · 30분 고정</span></div></div></div>
<div class="builder-bottom"><p>그날 참석 인원·모임 시간에 맞춰 자동 배정.<br>1인 최소 2경기 · 경기 수 차이는 최대 1경기.</p><button id="generate" class="primary">대진 만들기 <span>↗</span></button></div></div>
<button id="prep-shortcut" data-tab="prep" class="prep-shortcut">대회 준비 페어 설정 →</button><div id="schedule-content"></div></section>
<section id="ranking-view" hidden><div class="section-heading"><div><h2>우리의 스코어보드</h2><p>승점은 쌓이고, 기록은 남고.</p></div><label class="period-control"><span>조회 기간</span><select id="period"></select></label></div><div class="personal-tabs record-mode-tabs" role="group" aria-label="조회할 기록"><button data-record-mode="live" aria-pressed="true">경기 기록</button><button data-record-mode="archive" aria-pressed="false">이전 집계</button></div><div id="live-records"><div class="record-filters"><div id="custom-range" class="custom-range" hidden><label>시작일<input id="range-start" type="date" value="${rangeStart}"></label><label>종료일<input id="range-end" type="date" value="${rangeEnd}"></label><button id="apply-range" class="secondary">기간 적용</button><p id="range-error" role="alert"></p></div><div class="record-search"><label class="sr-only" for="record-search">회원·게스트 이름 검색</label><input id="record-search" type="search" placeholder="회원·게스트 이름 검색" autocomplete="off"><button id="clear-record-search" class="text-button" aria-label="이름 검색 지우기" hidden>지우기</button></div><p id="search-results" role="status"></p></div><div id="ranking-summary" class="summary-grid"></div><div class="rank-panel"><div class="panel-top"><h3 id="ranking-title"></h3><button id="export-csv" class="text-button">CSV 내려받기 ↓</button></div><p class="table-scroll-hint">좌우로 넘겨 전체 기록을 확인하세요.</p><div class="table-scroll" role="region" aria-label="개인 순위표" tabindex="0"><table><caption class="sr-only">GDR 개인 순위</caption><thead><tr><th>순위</th><th>이름</th><th>승점</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>승률</th><th>득</th><th>실</th><th>득실차</th></tr></thead><tbody id="rankings"></tbody></table></div><p class="table-note">승 3점 · 무 1점 · 패 0점 / 같은 승점은 공동순위 / 승률 = 승 ÷ 전체 경기</p></div><div class="record-image-tools"><div><h3>기록 이미지 2장</h3><p id="record-image-note">당일 결과와 하반기 누적 순위를 함께 보관하세요.</p></div><div class="record-image-controls"><label><span>누적 순위 기간</span><select id="stats-period"></select></label><label><span>당일 결과 날짜</span><select id="stats-date"></select></label><button id="export-record-images" class="secondary" disabled>두 장 저장·공유</button></div></div><div class="section-heading history-head"><h3>경기 기록</h3><label class="sr-only" for="player-filter">선수</label><select id="player-filter"><option value="">전체 멤버</option>${players.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div><div id="history"></div></div><div id="archive-records" hidden></div></section>
<section id="personal-view" hidden></section>
<section id="prep-view" hidden><div class="section-heading"><div><h2>같이 나갈 우리 조</h2><p>대회를 준비하는 두 멤버를 페어로 등록해 주세요.</p></div></div><div class="prep-editor"><div class="panel-top"><h3>멤버 두 명 선택</h3><span id="prep-selection-count">0 / 2</span></div><div id="prep-candidates" class="prep-candidates"></div><div class="prep-selection-footer"><p id="prep-selection-label">함께할 두 멤버를 선택해 주세요.</p><button id="add-prep-pair" class="primary" disabled>페어 등록</button></div></div><div class="section-heading prep-list-heading"><h3>등록된 페어 <span id="prep-pair-count">0조</span></h3><p>함께 참석하면 같은 팀으로 출전합니다.</p></div><div id="prep-pairs" class="prep-pairs"></div><p class="prep-footnote">한 멤버는 한 페어에 등록 가능. 한 명이 불참하면 해당 모임에는 적용하지 않습니다.</p></section>
<section id="members-view" hidden><div class="section-heading"><div><h2>우리 클럽 멤버</h2><p id="member-summary"></p></div><label class="period-control"><span>멤버 보기</span><select id="member-period"><option value="all">전체 멤버 ${players.length}명</option>${periods.map(period => `<option value="${period.id}">${period.label} ${period.memberIds.length}명</option>`).join('')}</select></label></div><div class="gender-legend"><span><i class="male-dot"></i>남성</span><span><i class="female-dot"></i>여성</span></div><div class="member-grid" id="member-grid"></div><div class="backup-panel"><div><h3>기록 보관</h3><p>${firebaseConfigured ? '공유 DB의 대진과 점수를 백업 파일로 보관할 수 있습니다.' : '로컬 기록은 이 브라우저에 저장됩니다. 백업 파일로 보관해 주세요.'}</p></div><div class="backup-actions"><button id="backup" class="secondary">백업 내려받기</button>${!firebaseConfigured ? '<label class="secondary file-label">백업 가져오기<input id="import" type="file" accept="application/json,.json"></label>' : ''}</div></div></section>
<footer><span>GDR TENNIS CLUB</span><span>매 경기, 함께 쌓는 기록.</span></footer></main><div id="toast" role="status" aria-live="polite" hidden></div>`;
setupTheme($('#theme-toggle'));
const personalView = mountPersonalView({ element: $('#personal-view'), players, getRecords: () => recordsFrom(state), getSessions: () => state.sessions, isReady: () => hasSnapshot, openDate: value => { setMeetingDate(value); switchTab('schedule'); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
const archiveView = mountArchiveView({ element: $('#archive-records'), players, openPlayer: (id, dataset) => { personalView.selectArchive(id, dataset); switchTab('personal'); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').hidden = true, 5500); }
function renderAttendees() {
  const members = membersForPeriod(date, players, periods, state.sessions);
  $('#attendees').innerHTML = members.map(p => `<label class="player-chip ${p.gender} ${selected.has(p.id) ? 'checked' : ''}"><input type="checkbox" value="${p.id}" ${selected.has(p.id) ? 'checked' : ''}><span class="chip-name ${p.gender}">${esc(p.name)}<span class="sr-only">${p.gender === 'female' ? '여성' : '남성'}</span></span><span class="checkmark">✓</span></label>`).join('');
  const allIds = [...members.map(p => p.id), ...Object.keys(guests)];
  $('#selected-count').textContent = `${selected.size} / ${allIds.length}명`; $('#select-all').textContent = selected.size === allIds.length && allIds.length ? '전체 해제' : '전체 선택';
  $('#select-all').disabled = !members.length;
  $('#generate').disabled = !members.length;
  $('#roster-note').hidden = !!members.length;
  $('#roster-note').textContent = `${periodLabel(quarter(date))} 멤버 명단이 아직 등록되지 않았습니다.`;
  $('#guest-count').textContent = `${Object.keys(guests).length}명`;
  $('#add-guest').disabled = !members.length || Object.keys(guests).length >= GUEST_IDS.length;
  $('#guests').innerHTML = Object.entries(guests).map(([id, guest]) => `<div class="guest-entry"><label class="player-chip guest ${selected.has(id) ? 'checked' : ''}"><input type="checkbox" value="${id}" ${selected.has(id) ? 'checked' : ''}><span>${esc(guest.name)}</span><span class="checkmark">✓</span></label><button data-remove-guest="${id}" class="text-button" aria-label="${esc(guest.name)} 게스트 삭제">삭제</button></div>`).join('');
  renderPrep();
}
function renderMembers() {
  const members = membersForPeriod(memberPeriod, players, periods, state.sessions);
  const currentIds = new Set(membersForPeriod(initialQuarter, players, periods).map(p => p.id));
  $('#member-summary').textContent = `${memberPeriod === 'all' ? '전체' : periodLabel(memberPeriod)} ${members.length}명 · 가나다순`;
  $('#member-grid').innerHTML = members.map((p, i) => `<article class="member ${p.gender}"><span class="member-number">${String(i + 1).padStart(2, '0')}</span><strong>${esc(p.name)}<span class="sr-only">${p.gender === 'female' ? '여성' : '남성'}</span></strong><span>${memberPeriod !== 'all' ? '분기 멤버' : currentIds.has(p.id) ? '이번 분기 멤버' : '클럽 멤버'}</span></article>`).join('');
}
function setMeetingDate(value) {
  const priorQuarter = quarter(date);
  date = value;
  const members = membersForPeriod(date, players, periods, state.sessions).map(p => p.id);
  guests = structuredClone(state.sessions[date]?.guests || {});
  selected = state.sessions[date] ? new Set(state.sessions[date].participantIds) : new Set(priorQuarter === quarter(date) ? members.filter(id => selected.has(id)) : members);
  $('#date').value = date;
  startTime = state.sessions[date]?.startTime || '19:00'; endTime = state.sessions[date]?.endTime || '21:00';
  syncMeetingTimes(); draft = null; dirty.clear(); prepSelection.clear(); renderAttendees(); renderSchedule();
  $('#guest-editor').hidden = true; $('#add-guest').setAttribute('aria-expanded', 'false'); $('#guest-name').value = '';
}
function updateConnection() { $('#connection-status').textContent = status; document.querySelector('.status-dot').classList.toggle('connected', writable); }
function renderSchedule() {
  const session = state.sessions[date] || draft;
  $('#builder').hidden = !!session;
  $('#schedule-view').classList.toggle('has-schedule', !!session);
  $('#prep-shortcut').hidden = !!session;
  document.querySelector('.page-head').hidden = !!session || tab !== 'schedule';
  const content = $('#schedule-content');
  if (!session) { content.innerHTML = '<div class="empty"><span class="court-drawing" aria-hidden="true"></span><h3>오늘 함께할 멤버를 골라 주세요.</h3><p>대진을 만들면 개인별 경기 수와 쉬는 라운드를 확인할 수 있어요.</p></div>'; return; }
  const saved = !!state.sessions[date], entries = Object.entries(session.matchMap), completed = entries.filter(([id]) => resultFor(state, session, id)).length;
  const labels = sessionNames(session, names);
  const rounds = [...new Set(entries.map(([, m]) => m.round))].sort((a, b) => a - b);
  const counts = Object.fromEntries(session.participantIds.map(id => [id, entries.filter(([, m]) => [...m.teamA, ...m.teamB].includes(id)).length]));
  const prepExceptions = (session.lockedPairs || []).reduce((sum, [a, b]) => sum + counts[a] - entries.filter(([, m]) => [m.teamA, m.teamB].some(team => team.includes(a) && team.includes(b))).length, 0);
  const maxGames = session.endTime ? meetingWindow(session.startTime, session.endTime) : Math.max(...Object.values(counts));
  const allocation = `<div class="allocation"><div class="panel-top"><h3>개인별 경기 수</h3><span>이번 모임</span></div><div class="allocation-grid">${session.participantIds.map(id => `<label><span>${esc(labels[id])}</span>${saved ? `<strong>${counts[id]}경기</strong>` : `<select data-quota="${id}" aria-label="${esc(labels[id])} 경기 수">${Array.from({ length: Math.max(0, maxGames - 1) }, (_, i) => i + 2).map(n => `<option value="${n}" ${counts[id] === n ? 'selected' : ''}>${n}경기</option>`).join('')}</select>`}</label>`).join('')}</div>${!saved ? '<p class="hint">개인 경기 수를 바꾸면 다시 배정됩니다. 총합은 4의 배수여야 합니다.</p><button id="apply-quotas" class="text-button">경기 수 조정 적용 →</button>' : ''}${session.lockedPairs?.length ? `<p class="hint">대회 준비 페어 ${session.lockedPairs.length}조 적용${prepExceptions ? ` · 참석 인원상 ${prepExceptions}회는 다른 파트너로 출전` : ''}</p>` : ''}${session.partnerRepeats ? `<p class="hint">같은 파트너 ${session.partnerRepeats}회 반복. 참가 인원·경기 수에 따른 배정입니다.</p>` : '<p class="hint">같은 파트너 중복 없이 배정.</p>'}</div>`;
  content.innerHTML = `<div class="schedule-meta"><div><span class="label-tag">${saved ? '저장된 대진' : '대진 미리보기'}</span><strong>${entries.length}경기 · ${rounds.length}라운드</strong><span>${session.startTime}${session.endTime ? `–${session.endTime}` : ''}</span><span>${completed}/${entries.length} 점수 입력</span></div><div>${saved ? `<button class="secondary" id="print">인쇄</button><button class="cancel-schedule" id="cancel-schedule" ${!writable ? 'disabled' : ''}>대진 취소</button>` : `<button class="secondary" id="edit-schedule">참석·시간 수정</button><button class="secondary" id="regenerate">다시 배정</button><button class="primary" id="save-schedule" ${!writable ? 'disabled' : ''}>대진 확정·저장</button>`}</div></div>
${prepExceptions ? `<p class="prep-exception-note">대회 준비 페어는 참석 인원상 ${prepExceptions}회 다른 파트너로 출전합니다.</p>` : ''}
<div class="schedule-image-tools"><button id="export-image" class="secondary">이미지 저장·공유</button><p>사진으로 보관하거나 카카오톡으로 보내세요.</p></div>

${rounds.map(round => {
  const matches = entries.filter(([, m]) => m.round === round), active = matches.flatMap(([, m]) => [...m.teamA, ...m.teamB]);
  const [hour, minute] = session.startTime.split(':').map(Number), minutes = hour * 60 + minute + (round - 1) * session.roundMinutes;
  const time = `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return `<section class="round"><div class="round-header"><div><span>ROUND ${String(round).padStart(2, '0')}</span><strong>${time}</strong></div><p>휴식 <span>${session.participantIds.filter(id => !active.includes(id)).map(id => esc(labels[id])).join(' · ') || '없음'}</span></p></div><div class="match-grid">${matches.map(([id, m]) => {
    const result = resultFor(state, session, id), editing = dirty.get(`${date}_${id}`), pending = editing?.generation === generationOf(session) ? editing : undefined;
    return `<article class="match"><div class="match-header"><span><i></i> ${courtName(m.court)} 코트</span><span class="match-type">복식</span></div><div class="teams"><div>${team(m.teamA)}</div><span class="versus">VS</span><div>${team(m.teamB)}</div></div>${saved ? `<form class="score-form" data-match="${id}" data-generation="${generationOf(session)}"><div class="score-inputs"><label class="sr-only" for="${id}-a">${esc(m.teamA.map(id => labels[id]).join(' · '))} 점수</label><input id="${id}-a" name="scoreA" enterkeyhint="next" type="number" min="0" max="99" step="1" inputmode="numeric" placeholder="—" value="${esc(pending?.scoreA ?? result?.scoreA ?? '')}" required><span>:</span><label class="sr-only" for="${id}-b">${esc(m.teamB.map(id => labels[id]).join(' · '))} 점수</label><input id="${id}-b" name="scoreB" enterkeyhint="done" type="number" min="0" max="99" step="1" inputmode="numeric" placeholder="—" value="${esc(pending?.scoreB ?? result?.scoreB ?? '')}" required></div><div class="score-footer"><span>${result ? result.outcome === 'draw' ? '무승부' : `${esc(labels[m[result.outcome][0]])} · ${esc(labels[m[result.outcome][1]])} 승` : '점수 미입력'}</span><button type="submit" class="text-button" ${!writable ? 'disabled' : ''}>${result ? '점수 수정' : '점수 저장'}</button></div></form>` : '<div class="preview-note">대진 확정 후 점수 입력</div>'}</article>`;
  }).join('')}${matches.length === 1 ? '<div class="idle-court">바깥쪽 코트 · 휴식</div>' : ''}</div></section>`;
}).join('')}
<details class="allocation-details"><summary><span>개인별 경기 수 ${saved ? '확인' : '확인·조정'}</span><small>${Math.min(...Object.values(counts))}–${Math.max(...Object.values(counts))}경기</small></summary>${allocation}</details>`;
}
function selectedPeriod() { return filter === 'custom' ? { start: rangeStart, end: rangeEnd } : filter; }
function scopedRecords() { return recordsFrom(state).filter(r => withinPeriod(selectedPeriod(), r.date)); }
function scopedPlayers(value = selectedPeriod()) {
  const ids = new Set(membersForPeriod(value, players, periods, state.sessions).map(player => player.id));
  for (const row of datedHistory(historySets, value, recordsFrom(state))) ids.add(row.playerId);
  return historicalPlayers(historySets, players).filter(player => ids.has(player.id));
}
function renderRanking() {
  const years = [...new Set([koreaToday().slice(0, 4), ...Object.keys(state.sessions).map(date => date.slice(0, 4)), ...historySets.filter(set => set.datePrecision === 'day' && set.cutoff).map(set => set.cutoff.slice(0, 4)), ...periods.map(p => p.id.slice(0, 4)), ...(baseline.sourcePeriod ? [baseline.sourcePeriod.slice(0, 4)] : [])])];
  const values = years.flatMap(year => [1, 2, 3, 4].map(q => `${year}-Q${q}`)).sort().reverse();
  const halves = years.flatMap(year => [2, 1].map(half => `${year}-H${half}`)).sort().reverse();
  $('#period').innerHTML = `<option value="all">전체 날짜별 기록</option><option value="custom">기간 직접 선택</option><optgroup label="반기별">${halves.map(v => `<option value="${v}">${periodLabel(v)}</option>`).join('')}</optgroup><optgroup label="분기별">${values.map(v => `<option value="${v}">${periodLabel(v)}</option>`).join('')}</optgroup><optgroup label="모임별">${[...new Set([...Object.keys(state.sessions), ...datedHistory(historySets).map(row => row.date)])].sort().reverse().map(d => `<option value="${d}">${d}</option>`).join('')}</optgroup>`;
  $('#period').value = filter;
  $('#custom-range').hidden = filter !== 'custom';
  $('#clear-record-search').hidden = !search;
  const members = scopedPlayers();
  if (!members.some(p => p.id === playerFilter)) playerFilter = '';
  $('#player-filter').innerHTML = `<option value="">전체 멤버</option>${members.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}`;
  $('#stats-period').innerHTML = `<optgroup label="반기별">${halves.map(v => `<option value="${v}">${periodLabel(v)}</option>`).join('')}</optgroup><optgroup label="분기별">${values.map(v => `<option value="${v}">${periodLabel(v)}</option>`).join('')}</optgroup>`;
  $('#stats-period').value = imagePeriod;
  const previousDate = $('#stats-date').value;
  const imageDates = hasSnapshot ? [...new Set([...recordsFrom(state).filter(record => withinPeriod(imagePeriod, record.date)).map(record => record.date), ...datedHistory(historySets, imagePeriod, recordsFrom(state)).map(row => row.date)])].sort().reverse() : [];
  $('#stats-date').innerHTML = imageDates.length ? imageDates.map(value => `<option value="${value}">${value}</option>`).join('') : '<option value="">완료 기록 없음</option>';
  $('#stats-date').value = imageDates.includes(previousDate) ? previousDate : imageDates.includes(date) ? date : imageDates[0] || '';
  $('#stats-date').disabled = !imageDates.length;
  $('#export-record-images').disabled = !imageDates.length;
  $('#record-image-note').textContent = imageDates.length ? `당일 결과 + ${periodLabel(imagePeriod)} 누적 순위 · 선택한 날짜까지의 기록을 이미지 2장으로 저장·공유합니다.` : `${periodLabel(imagePeriod)}에 저장된 날짜별 기록이 없습니다. 다른 기간을 선택해 주세요.`;
  if (!hasSnapshot) {
    $('#ranking-title').textContent = `${periodLabel(selectedPeriod())} 순위`;
    $('#ranking-summary').innerHTML = '';
    $('#rankings').innerHTML = '<tr><td colspan="11" class="records-pending">공유 기록에 연결하면 순위를 표시합니다.</td></tr>';
    $('#history').innerHTML = '<div class="empty compact"><h3>기록 연결을 기다리고 있어요.</h3><p>연결 상태를 확인해 주세요. 아직 기록을 불러오지 못했습니다.</p></div>';
    $('#export-csv').disabled = true;
    $('#search-results').textContent = '';
    return;
  }
  $('#export-csv').disabled = false;
  const records = scopedRecords(), allRows = rankingWithHistory(recordsFrom(state), members, selectedPeriod(), historySets), rows = allRows.filter(player => matchesPlayer(player, search)), participating = allRows.filter(r => r.games).length;
  $('#ranking-title').textContent = `${periodLabel(selectedPeriod())} 순위`;
  $('#ranking-summary').innerHTML = [[datedHistory(historySets, selectedPeriod(), recordsFrom(state)).length ? '개인 경기 수' : '완료 경기', datedHistory(historySets, selectedPeriod(), recordsFrom(state)).length ? allRows.reduce((sum, row) => sum + row.games, 0) : records.length, '경기'], ['기록된 모임', new Set([...records.map(r => r.date), ...datedHistory(historySets, selectedPeriod(), recordsFrom(state)).map(row => row.date)]).size, '회'], ['경기한 멤버', participating, '명']].map(([label, n, unit]) => `<div><span>${label}</span><strong>${n}<small>${unit}</small></strong></div>`).join('');
  $('#rankings').innerHTML = rows.map(r => `<tr class="${r.rank === 1 ? 'first' : ''}"><td>${r.rank ?? '—'}</td><td><button class="name-button" data-player="${r.id}">${esc(r.name)}</button>${r.historyReview ? '<span class="rank-review" title="이전 자료에 확인할 항목이 있습니다">확인</span>' : ''}</td><td class="points">${r.points}</td><td>${r.games}</td><td>${r.wins}</td><td>${r.draws}</td><td>${r.losses}</td><td>${r.winRate === null ? '—' : r.winRate + '%'}</td><td>${r.scored}</td><td>${r.conceded}</td><td>${r.difference > 0 ? '+' : ''}${r.difference}</td></tr>`).join('') || `<tr><td colspan="11">${search ? '검색 결과가 없습니다.' : '이 기간의 멤버 명단과 기록이 아직 없습니다.'}</td></tr>`;
  const oldRows = datedHistory(historySets, selectedPeriod(), recordsFrom(state)).filter(row => (!playerFilter || row.playerId === playerFilter) && matchesPlayer(historicalPlayers(historySets, players).find(player => player.id === row.playerId), search));
  const games = records.filter(r => (!playerFilter || [...r.teamA, ...r.teamB].includes(playerFilter)) && matchesRecord(r, players, search)).sort((a, b) => b.date.localeCompare(a.date) || a.round - b.round || a.court - b.court);
  $('#search-results').textContent = search ? `이름 검색 결과 · 회원 ${rows.length}명 · 경기 ${games.length}건${oldRows.length ? ` · 이전 집계 ${oldRows.length}건` : ''}` : '';
  $('#player-filter').value = playerFilter;
  $('#history').innerHTML = games.length ? games.map(r => `<article class="history-card"><span>${r.date} · ${r.round}라운드 · ${courtName(r.court)} 코트</span><div>${team(r.teamA, r.guests)} <strong>${r.scoreA} : ${r.scoreB}</strong> ${team(r.teamB, r.guests)}</div><button class="text-button" data-open-date="${r.date}">대진표 보기 →</button></article>`).join('') : `<div class="empty compact"><h3>${search || playerFilter ? '검색에 맞는 경기 결과가 없습니다.' : '아직 저장된 경기 결과가 없어요.'}</h3><p>${search || playerFilter ? '이름 검색이나 선수·조회 기간을 바꿔 주세요.' : '대진표에서 점수를 저장하면 순위와 기록이 반영됩니다.'}</p></div>`;
  if (oldRows.length && !games.length) $('#history').innerHTML = '';
  if (oldRows.length) $('#history').insertAdjacentHTML('afterbegin', `<details class="historical-daily-list"><summary>이전 날짜별 개인 기록 ${oldRows.length}건 보기</summary><p class="hint">승점·경기 수·득실차는 승무패·득실에서 계산합니다.</p>${oldRows.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'ko')).map(row => `<article class="history-card"><span>${row.date} · 이전 개인 집계${row.review ? ' · 원본 확인 항목 있음' : ''}</span><div><strong>${esc(historicalPlayers(historySets, players).find(player => player.id === row.playerId)?.name || row.name)}</strong> ${row.wins}승 ${row.draws}무 ${row.losses}패 · 승점 ${row.points}</div><button class="text-button" data-history-detail="${esc(row.sourceId)}" data-history-member="${row.playerId}">원본 보기 →</button></article>`).join('')}</details>`);
}
function renderPrep() {
  const used = new Set(lockedPairs.flat());
  $('#prep-candidates').innerHTML = membersForPeriod(date, players, periods, state.sessions).map(p => `<button class="prep-candidate ${p.gender} ${prepSelection.has(p.id) ? 'selected' : ''}" data-prep-player="${p.id}" aria-pressed="${prepSelection.has(p.id)}" ${used.has(p.id) || (prepSelection.size === 2 && !prepSelection.has(p.id)) ? 'disabled' : ''}><span>${esc(p.name)}</span><small>${used.has(p.id) ? '등록됨' : prepSelection.has(p.id) ? '선택됨' : '+'}</small></button>`).join('');
  $('#prep-selection-count').textContent = `${prepSelection.size} / 2`;
  $('#prep-selection-label').textContent = prepSelection.size ? [...prepSelection].map(id => names[id]).join(' · ') : '함께할 두 멤버를 선택해 주세요.';
  $('#add-prep-pair').disabled = prepSelection.size !== 2;
  $('#prep-pair-count').textContent = `${lockedPairs.length}조`;
  $('#prep-pairs').innerHTML = lockedPairs.length ? lockedPairs.map((pair, index) => `<article class="prep-pair-card"><span class="prep-pair-number">${String(index + 1).padStart(2, '0')}</span><div><strong>${esc(names[pair[0]])}<span>·</span>${esc(names[pair[1]])}</strong><small>${pair.every(id => selected.has(id)) ? '이번 모임에 함께 참석' : '이번 모임에 한 명 이상 불참'}</small></div><button data-remove-prep="${index}" class="text-button" aria-label="${pair.map(id => esc(names[id])).join(' · ')} 페어 해제">해제</button></article>`).join('') : '<div class="prep-empty">등록된 페어가 없습니다.<br><span>위에서 두 멤버를 선택해 첫 페어를 만들어 주세요.</span></div>';
  $('#prep-shortcut').textContent = lockedPairs.length ? `대회 준비 페어 ${lockedPairs.length}조 · 설정 →` : '대회 준비 페어 설정 →';
}
function syncMeetingTimes() {
  $('#start').value = startTime;
  $('#end').value = endTime;
  document.querySelectorAll('[data-meeting-time]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.meetingTime === `${startTime}/${endTime}`)));
}
function render() { updateConnection(); syncMeetingTimes(); renderSchedule(); renderRanking(); renderPrep(); renderMembers(); personalView.render(); }
function switchTab(value) {
  const headingBottom = document.querySelector('header').getBoundingClientRect().bottom;
  const tabsTop = window.scrollY + headingBottom;
  const returnToTabs = window.matchMedia('(max-width: 600px)').matches && headingBottom < 0;
  tab = value;
  document.querySelectorAll('[data-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.tab === tab)));
  for (const name of ['schedule', 'ranking', 'personal', 'prep', 'members']) $(`#${name}-view`).hidden = name !== tab;
  document.querySelector('.page-head').hidden = tab !== 'schedule' || !!(state.sessions[date] || draft);
  if (returnToTabs) window.scrollTo({ top: tabsTop, behavior: 'instant' });
}
function build(quotas) {
  if (!$('#date').value) throw new Error('모임 날짜를 입력해 주세요.');
  const ids = [...selected];
  const windowRounds = meetingWindow(startTime, endTime);
  const activePairs = lockedPairs.filter(pair => pair.every(id => ids.includes(id)));
  quotas ??= allocateForWindow(ids, windowRounds, activePairs);
  const strengths = strengthsForSession(recordsFrom(state), players.map(p => p.id), baseline, date, historySets);
  for (const id of ids) if (Object.hasOwn(guests, id)) strengths[id] = GUEST_STRENGTH;
  const result = generateSchedule(ids, quotas, { strengths, lockedPairs: activePairs });
  if (Math.max(...Object.values(result.matchMap).map(m => m.round)) > windowRounds) throw new Error('조정한 경기 수를 모임 시간 안에 배정할 수 없습니다. 종료 시간을 늘리거나 경기 수를 줄여 주세요.');
  const profiles = Object.fromEntries(Object.entries(guests).filter(([id]) => selected.has(id)));
  draft = { schemaVersion: 1, date, participantIds: ids, fixedPlayerIds: ids.filter(id => Object.hasOwn(names, id)), ...(Object.keys(profiles).length ? { guests: profiles } : {}), startTime, roundMinutes, endTime, matchMap: result.matchMap, partnerRepeats: result.partnerRepeats, lockedPairs: activePairs };
  renderSchedule();
}
function download(content, filename, type) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
$('#app').addEventListener('click', async event => {
  if (event.target.closest('.brand')) { event.preventDefault(); switchTab('schedule'); window.scrollTo({ top: 0, behavior: 'instant' }); return; }
  const button = event.target.closest('button'); if (!button) return;
  try {
    if (button.dataset.tab) switchTab(button.dataset.tab);
    else if (button.dataset.recordMode) {
      const archived = button.dataset.recordMode === 'archive';
      $('#live-records').hidden = archived; $('#archive-records').hidden = !archived;
      $('#ranking-view > .section-heading .period-control').hidden = archived;
      document.querySelectorAll('[data-record-mode]').forEach(option => option.setAttribute('aria-pressed', String(option === button)));
    }
    else if (button.id === 'clear-record-search') { search = ''; $('#record-search').value = ''; renderRanking(); $('#record-search').focus(); }
    else if (button.id === 'apply-range') {
      const start = $('#range-start').value, end = $('#range-end').value;
      const message = !validDate(start) || !validDate(end) ? '시작일과 종료일을 입력해 주세요.' : start > end ? '종료일을 시작일 이후로 선택해 주세요.' : '';
      $('#range-error').textContent = message;
      if (message) throw new Error(message);
      rangeStart = start; rangeEnd = end; renderRanking();
    }
    else if (button.id === 'add-guest') { $('#guest-editor').hidden = false; button.setAttribute('aria-expanded', 'true'); $('#guest-name').focus(); }
    else if (button.id === 'cancel-guest') { $('#guest-editor').hidden = true; $('#add-guest').setAttribute('aria-expanded', 'false'); $('#guest-name').value = ''; $('#add-guest').focus(); }
    else if (button.dataset.removeGuest) { const id = button.dataset.removeGuest; delete guests[id]; selected.delete(id); draft = null; renderAttendees(); renderSchedule(); }
    else if (button.dataset.meetingTime) {
      [startTime, endTime] = button.dataset.meetingTime.split('/');
      syncMeetingTimes(); draft = null; renderSchedule();
    }
    else if (button.dataset.prepPlayer) {
      const id = button.dataset.prepPlayer;
      if (prepSelection.has(id)) prepSelection.delete(id); else if (prepSelection.size < 2) prepSelection.add(id);
      renderPrep();
    } else if (button.id === 'add-prep-pair' && prepSelection.size === 2) {
      lockedPairs.push([...prepSelection]); prepSelection.clear(); localStorage.setItem('gdr-prep-pairs', JSON.stringify(lockedPairs)); draft = null; render(); toast('대회 준비 페어를 등록했습니다.');
    } else if (button.dataset.removePrep !== undefined) {
      lockedPairs.splice(Number(button.dataset.removePrep), 1); localStorage.setItem('gdr-prep-pairs', JSON.stringify(lockedPairs)); draft = null; render(); toast('페어를 해제했습니다.');
    }
    else if (button.id === 'select-all') { const ids = [...membersForPeriod(date, players, periods, state.sessions).map(p => p.id), ...Object.keys(guests)]; selected = new Set(selected.size === ids.length ? [] : ids); draft = null; renderAttendees(); renderSchedule(); }
    else if (button.id === 'export-image') { const session = state.sessions[date] || draft; if (session) await openScheduleImage(session, names, state.results, !!state.sessions[date]); }
    else if (button.id === 'export-record-images') { await openRecordImages(recordsFrom(state), scopedPlayers(imagePeriod), imagePeriod, $('#stats-date').value, historySets); }
    else if (button.id === 'edit-schedule') { draft = null; renderSchedule(); $('#builder').scrollIntoView({ block: 'start', behavior: 'smooth' }); }
    else if (button.id === 'generate' || button.id === 'regenerate') { build(); $('#schedule-content').scrollIntoView({ block: 'start', behavior: 'smooth' }); toast('대진을 만들었습니다. 확인 후 확정해 주세요.'); }
    else if (button.id === 'apply-quotas') { build(Object.fromEntries([...document.querySelectorAll('[data-quota]')].map(select => [select.dataset.quota, Number(select.value)]))); toast('개인 경기 수를 반영했습니다.'); }
    else if (button.id === 'save-schedule') { if (!store?.canWrite) throw new Error('저장 연결 상태를 확인해 주세요.'); button.disabled = true; await store.saveSession(draft); draft = null; renderSchedule(); toast('대진 저장 완료. 점수를 입력할 수 있습니다.'); }
    else if (button.id === 'cancel-schedule') {
      const session = state.sessions[date];
      if (!session || !store?.canWrite) throw new Error('저장 연결 상태를 확인해 주세요.');
      const completed = Object.keys(session.matchMap).filter(id => resultFor(state, session, id)).length;
      openCancellation(session, completed, async text => {
        await store.cancelSession(session.date, generationOf(session), text);
        draft = null; dirty.clear(); setMeetingDate(session.date); render(); toast('대진과 점수를 삭제했습니다. 다시 만들 수 있습니다.');
      });
    }
    else if (button.id === 'print') window.print();
    else if (button.dataset.historyDetail) { personalView.selectArchive(button.dataset.historyMember, button.dataset.historyDetail); switchTab('personal'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (button.dataset.player) { personalView.selectPlayer(button.dataset.player, selectedPeriod()); switchTab('personal'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (button.dataset.openDate) { setMeetingDate(button.dataset.openDate); switchTab('schedule'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (button.id === 'backup') download(JSON.stringify(state, null, 2), `gdr-backup-${koreaToday()}.json`, 'application/json');
    else if (button.id === 'export-csv') {
      const rows = rankingWithHistory(recordsFrom(state), scopedPlayers(), selectedPeriod(), historySets).filter(player => matchesPlayer(player, search));
      const columns = ['rank', 'name', 'points', 'games', 'wins', 'draws', 'losses', 'winRate', 'scored', 'conceded', 'difference'];
      const csv = [['순위', '이름', '승점', '경기수', '승', '무', '패', '승률', '득', '실', '득실차'], ...rows.map(r => columns.map(c => r[c] ?? ''))].map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
      download('\uFEFF' + csv, `gdr-${filter === 'custom' ? `${rangeStart}_${rangeEnd}` : filter}.csv`, 'text/csv;charset=utf-8');
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
  else if (input.closest('#attendees') || input.closest('#guests')) { if (input.checked) selected.add(input.value); else selected.delete(input.value); draft = null; renderAttendees(); renderSchedule(); }
  else if (input.id === 'date') { setMeetingDate(input.value); }
  else if (['start', 'end'].includes(input.id)) { startTime = $('#start').value; endTime = $('#end').value; syncMeetingTimes(); draft = null; renderSchedule(); }
  else if (input.id === 'period') { filter = input.value; $('#range-error').textContent = ''; renderRanking(); }
  else if (input.id === 'stats-period') { imagePeriod = input.value; renderRanking(); }
  else if (input.id === 'player-filter') { playerFilter = input.value; renderRanking(); }
  else if (input.id === 'member-period') { memberPeriod = input.value; renderMembers(); }
  else if (input.id === 'import' && input.files[0]) {
    try { const text = await input.files[0].text(); const parsed = JSON.parse(text); if (!confirm(`${Object.keys(parsed.sessions || {}).length}개 모임을 가져옵니다. 같은 날짜가 있으면 가져오기를 중단합니다.`)) return; await store.importBackup(text); toast('백업 가져오기 완료.'); } catch (error) { toast(error.message); } input.value = '';
  }
});
$('#app').addEventListener('input', event => {
  if (event.target.id === 'record-search') { search = event.target.value; renderRanking(); return; }
  const form = event.target.closest('[data-match]');
  if (form) { const key = `${date}_${form.dataset.match}`, prior = dirty.get(key); dirty.set(key, { scoreA: form.scoreA.value, scoreB: form.scoreB.value, generation: form.dataset.generation, revision: prior?.generation === form.dataset.generation ? prior.revision : resultFor(state, state.sessions[date], form.dataset.match)?.revision ?? 0 }); }
});
$('#app').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing && event.target.name === 'scoreA' && event.target.closest('.score-form')) {
    event.preventDefault();
    event.target.form.elements.scoreB.focus();
  }
});
$('#app').addEventListener('submit', async event => {
  if (event.target.id === 'guest-form') {
    event.preventDefault();
    try {
      const name = normalizeGuestName($('#guest-name').value), id = GUEST_IDS.find(id => !Object.hasOwn(guests, id));
      if (!id) throw new Error('게스트는 모임당 최대 8명까지 추가할 수 있습니다.');
      if (membersForPeriod(date, players, periods).some(player => player.name === name)) throw new Error('분기 명단에 있는 이름입니다. 참석 멤버에서 선택해 주세요.');
      validateGuests({ ...guests, [id]: { name } }); guests[id] = { name }; selected.add(id); draft = null;
      $('#guest-name').value = ''; $('#guest-editor').hidden = true; $('#add-guest').setAttribute('aria-expanded', 'false');
      renderAttendees(); renderSchedule(); $('#add-guest').focus(); toast('게스트를 추가했습니다.');
    } catch (error) { toast(error.message); $('#guest-name').focus(); }
    return;
  }
  const form = event.target.closest('[data-match]'); if (!form) return; event.preventDefault();
  const button = form.querySelector('button'); button.disabled = true;
  try {
    const scoreA = Number(form.scoreA.value), scoreB = Number(form.scoreB.value), key = `${date}_${form.dataset.match}`, revision = dirty.get(key)?.revision ?? resultFor(state, state.sessions[date], form.dataset.match)?.revision ?? 0;
    await store.saveResult(date, form.dataset.match, { scoreA, scoreB, outcome: outcome(scoreA, scoreB) }, revision, form.dataset.generation);
    dirty.delete(key); render(); toast('점수 저장 완료. 순위에 반영했습니다.');
  } catch (error) { toast(error.message); button.disabled = false; }
});
renderAttendees(); render();
try { store = await createStore(next => {
  if (generationOf(state.sessions[date]) !== generationOf(next.sessions[date]) || !!state.sessions[date] !== !!next.sessions[date]) { dirty.clear(); draft = null; }
  state = next; hasSnapshot = true; render();
}, (text, canWrite) => { status = text; writable = canWrite; render(); }); await readHistory(sets => { historySets = sets; personalView.setHistory(sets); archiveView.setHistory(sets); renderRanking(); }, text => { personalView.setHistoryStatus(text); archiveView.setHistoryStatus(text); }); }
catch (error) { status = error.message; writable = false; updateConnection(); }
window.addEventListener('offline', () => { if (firebaseConfigured) { writable = false; status = '인터넷 연결 끊김 · 입력값은 유지됩니다'; updateConnection(); renderSchedule(); } });
window.addEventListener('online', () => { if (firebaseConfigured) { writable = store?.canWrite || false; status = '공유 기록 다시 연결 중'; updateConnection(); renderSchedule(); } });
