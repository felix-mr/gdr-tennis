import { koreaToday, quarter, validDate } from './model.js';
import { withinPeriod, periodLabel, quarterBounds } from './periods.js';
import { matchesName } from './search.js';
import { personalMatchups } from './matchups.js';
import { rankingWithHistory } from './history-stats.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const formatStats = row => `${row.wins}승 ${row.draws}무 ${row.losses}패`;
const statusLabel = status => ({ quarantine: '확인 필요', 'identity-unconfirmed': '인물 확인 필요', 'date-unconfirmed': '연도 확인 필요', superseded: '정정 전 원본' }[status] || '원본 집계');
const issueLabel = issue => ({ 'asymmetric-values': '양쪽 표의 값이 다르거나 한쪽 기록이 없습니다', 'ambiguous-identity': '진우가 누구인지 확인이 필요합니다', 'guest-group-not-person': '게스트 전체 집계로 개인별 구분이 없습니다' }[issue] || issue);

export function mountPersonalView({ element, players, getRecords, getSessions, isReady, openDate }) {
  let selected = players[0].id, period = quarter(koreaToday()), mode = 'partners', query = '', selectedKey = '';
  let start = quarterBounds(period).start, end = koreaToday(), history = [], historyStatus = '이전 기록 불러오는 중…', datasetId = 'career-2026-06';
  const $ = selector => element.querySelector(selector);
  const currentPeriod = () => period === 'custom' ? { start, end } : period;
  element.innerHTML = `<div class="section-heading"><div><h2>개인 경기 기록</h2><p>함께한 파트너와 상대한 페어별로.</p></div></div>
    <div class="personal-controls"><label>멤버<select id="personal-player"></select></label><label>조회 기간<select id="personal-period"></select></label></div>
    <div class="custom-range" id="personal-range" hidden><label>시작일<input type="date" id="personal-start" value="${start}"></label><label>종료일<input type="date" id="personal-end" value="${end}"></label><button class="secondary" id="personal-apply">기간 적용</button><p id="personal-error" role="alert"></p></div>
    <div class="personal-tabs" role="group" aria-label="개인 기록 종류"><button data-personal-mode="partners" aria-pressed="true">파트너별</button><button data-personal-mode="opponents" aria-pressed="false">상대 페어별</button><button data-personal-mode="archive" aria-pressed="false">이전 집계</button></div>
    <div id="personal-summary" class="summary-grid"></div><p id="personal-note" class="personal-note"></p>
    <label class="archive-selector" id="archive-selector" hidden>이전 기록 선택<select id="archive-set"></select></label>
    <div class="record-search"><label class="sr-only" for="personal-search">파트너·상대 이름 검색</label><input id="personal-search" type="search" placeholder="파트너·상대 이름 검색" autocomplete="off"><button id="personal-clear" class="text-button" hidden>지우기</button></div>
    <div id="personal-groups" class="personal-groups"></div><div id="personal-details"></div>`;

  const allNames = () => Object.fromEntries([
    ...players.map(player => [player.id, player.name]),
    ...history.filter(set => set.kind === 'individual-aggregate').flatMap(set => set.rows.filter(row => row.playerId?.startsWith('past-')).map(row => [row.playerId, row.name])),
  ]);
  const renderArchive = () => {
    const sets = history.filter(set => ['individual-aggregate', 'partner-aggregate', 'daily-individual-aggregate'].includes(set.kind)).sort((a, b) => Number(a.status === 'superseded') - Number(b.status === 'superseded') || Number(!a.id.startsWith('career-')) - Number(!b.id.startsWith('career-')) || (b.cutoff || '').localeCompare(a.cutoff || ''));
    if (!sets.some(set => set.id === datasetId)) datasetId = sets[0]?.id || '';
    $('#archive-set').innerHTML = sets.map(set => `<option value="${esc(set.id)}">${esc(set.title)}</option>`).join('') || '<option>기록 없음</option>';
    $('#archive-set').value = datasetId; $('#archive-set').disabled = !sets.length;
    const dataset = sets.find(set => set.id === datasetId);
    $('#personal-summary').innerHTML = '';
    $('#personal-note').textContent = `${historyStatus}. 이전 집계는 각 원본 기준일의 스냅샷이며 새 경기와 합산하지 않습니다.`;
    if (!dataset) { $('#personal-groups').innerHTML = '<div class="empty compact"><h3>이전 기록을 기다리고 있습니다.</h3></div>'; $('#personal-details').innerHTML = ''; return; }
    const partner = dataset.kind === 'partner-aggregate';
    $('#personal-search').closest('.record-search').hidden = !partner;
    const names = allNames();
    const partnerTitle = row => {
      const index = row.playerIds?.[0] === selected ? 1 : 0;
      return names[row.playerIds?.[index]] || (row.names[index] === 'Guest' ? '게스트 전체' : row.names[index]);
    };
    const rows = dataset.rows.filter(row => partner ? row.playerIds?.includes(selected) : row.playerId === selected).filter(row => !partner || matchesName(partnerTitle(row), query)).sort((a, b) => Number(a.status === 'quarantine') - Number(b.status === 'quarantine') || (b.stats?.games || 0) - (a.stats?.games || 0));
    $('#personal-groups').innerHTML = rows.map(row => {
      const reviewed = row.status === 'quarantine' || row.issues?.length || dataset.status === 'superseded' || dataset.datePrecision === 'unconfirmed' || row.identityStatus === 'tentative-user-guidance';
      const title = partner ? partnerTitle(row) : names[selected];
      const stats = row.stats;
      const raw = row.sides?.filter(Boolean).map(side => side.raw).join(' / ');
      const issues = (row.issues || []).map(issue => typeof issue === 'string' ? issueLabel(issue) : issue.field === 'identity' ? '진우 인물 잠정 연결' : `${issue.field === 'points' ? '승점' : issue.field === 'games' ? '경기 수' : issue.field === 'difference' ? '득실차' : '승률'}: 원본 ${issue.provided} / 계산 ${issue.expected}`).join(' · ');
      return `<article class="archive-card"><div class="archive-card-heading"><h3>${esc(title)}</h3><span class="archive-badge ${reviewed ? 'review' : ''}">${esc(reviewed ? dataset.status === 'superseded' ? '정정 전 원본' : dataset.datePrecision === 'unconfirmed' ? '연도 확인 필요' : '확인 필요' : '원본 집계')}</span></div>${stats ? `<p class="archive-score">${stats.games ?? stats.wins + stats.draws + stats.losses}경기 · ${formatStats(stats)}</p><p class="hint">${stats.points !== undefined ? `승점 ${stats.points} · ` : ''}${stats.scored !== undefined ? `득 ${stats.scored} / 실 ${stats.conceded} · 득실차 ${stats.difference > 0 ? '+' : ''}${stats.difference}` : `승률 ${stats.games ? Math.round(100 * stats.wins / stats.games) : 0}%`}</p>` : `<p class="archive-score">양쪽 원본: ${esc(raw || '기록 없음')}</p>`}${issues ? `<p class="archive-review-note">${esc(issues)}</p>` : ''}${partner && reviewed ? '<p class="archive-review-note">값 또는 인물 확인 전 경기 통계에 합산하지 않습니다.</p>' : ''}</article>`;
    }).join('') || '<div class="empty compact"><h3>선택한 멤버의 집계가 없습니다.</h3><p>다른 원본 기록을 선택해 주세요.</p></div>';
    const unassigned = dataset.rows.filter(row => !row.playerId && !row.playerIds);
    $('#personal-details').innerHTML = `<p class="archive-dataset-note">${esc(dataset.note || '')}</p>${unassigned.length ? `<details class="archive-unresolved"><summary>인물 확인이 필요한 원본 ${unassigned.length}건</summary>${unassigned.map(row => `<p>${esc(row.name)} · ${row.stats.games ?? row.stats.wins + row.stats.draws + row.stats.losses}경기 · ${formatStats(row.stats)} · ${esc(statusLabel(row.status))}</p>`).join('')}</details>` : ''}`;
  };
  function render() {
    const nameMap = allNames();
    $('#personal-player').innerHTML = `<optgroup label="클럽 멤버">${players.map(player => `<option value="${player.id}">${esc(player.name)}</option>`).join('')}</optgroup>${Object.entries(nameMap).some(([id]) => id.startsWith('past-')) ? `<optgroup label="이전 멤버">${Object.entries(nameMap).filter(([id]) => id.startsWith('past-')).sort((a, b) => a[1].localeCompare(b[1], 'ko')).map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('')}</optgroup>` : ''}`;
    $('#personal-player').value = selected;
    const dates = [...new Set([...Object.keys(getSessions()), ...history.filter(set => set.kind === 'daily-individual-aggregate' && set.status !== 'superseded' && set.datePrecision === 'day').map(set => set.cutoff)])].sort().reverse();
    const years = [...new Set([koreaToday().slice(0, 4), ...dates.map(date => date.slice(0, 4))])].sort().reverse();
    $('#personal-period').innerHTML = `<option value="all">전체 경기</option><option value="custom">기간 직접 선택</option>${years.map(year => `<optgroup label="${year}년">${[4, 3, 2, 1].map(q => `<option value="${year}-Q${q}">${periodLabel(`${year}-Q${q}`)}</option>`).join('')}${[2, 1].map(h => `<option value="${year}-H${h}">${periodLabel(`${year}-H${h}`)}</option>`).join('')}</optgroup>`).join('')}<optgroup label="모임별">${dates.map(date => `<option value="${date}">${date}</option>`).join('')}</optgroup>`;
    $('#personal-period').value = period; $('#personal-period').disabled = mode === 'archive';
    $('#personal-period').closest('label').hidden = mode === 'archive';
    element.querySelector('.personal-controls').classList.toggle('archive-mode', mode === 'archive');
    $('#personal-search').closest('.record-search').hidden = false;
    $('#personal-range').hidden = period !== 'custom' || mode === 'archive';
    $('#archive-selector').hidden = mode !== 'archive';
    $('#personal-clear').hidden = !query;
    $('#personal-search').placeholder = mode === 'opponents' ? '상대 페어 이름 검색' : '파트너 이름 검색';
    document.querySelectorAll('[data-personal-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.personalMode === mode)));
    if (mode === 'archive') { renderArchive(); return; }
    if (!isReady()) { $('#personal-summary').innerHTML = ''; $('#personal-groups').innerHTML = '<div class="empty compact"><h3>공유 경기 기록을 기다리고 있습니다.</h3></div>'; $('#personal-details').innerHTML = ''; $('#personal-note').textContent = '연결 상태를 확인해 주세요.'; return; }
    const rows = personalMatchups(getRecords().filter(record => withinPeriod(currentPeriod(), record.date)), selected, nameMap);
    const total = rankingWithHistory(getRecords(), Object.entries(nameMap).map(([id, name]) => ({ id, name })), currentPeriod(), history).find(row => row.id === selected) || rows.total;
    $('#personal-summary').innerHTML = [['경기 수', `${total.games}경기`], ['승·무·패', `${total.wins} · ${total.draws} · ${total.losses}`], ['승률', total.winRate === null ? '—' : `${total.winRate}%`]].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
    $('#personal-note').textContent = `${periodLabel(currentPeriod())} · 실제 경기 ${rows.total.games}건${total.historyGames ? ` · 이전 개인 집계 ${total.historyGames}경기 포함. 파트너·상대 페어는 실제 대진이 있는 경기로 조회합니다.` : '.'} ${mode === 'partners' ? '파트너 이름을 누르면 함께 뛴 경기를 확인합니다.' : '상대 페어를 누르면 맞붙은 경기를 확인합니다.'}`;
    const groups = rows[mode].filter(row => row.names.some(name => matchesName(name, query)));
    $('#personal-groups').innerHTML = groups.map(row => `<button class="relation-card ${selectedKey === row.key ? 'selected' : ''}" data-relation-key="${esc(row.key)}" aria-pressed="${selectedKey === row.key}"><span class="relation-heading"><strong>${row.names.map(esc).join(' · ')}</strong><small>${row.games}경기${row.guest ? ' · 게스트 포함' : ''}</small></span><span class="relation-score">${formatStats(row)}<strong>${row.winRate}%</strong></span><span class="relation-goals">득 ${row.scored} / 실 ${row.conceded} · 득실차 ${row.difference > 0 ? '+' : ''}${row.difference}<span>경기 보기 →</span></span></button>`).join('') || '<div class="empty compact"><h3>해당 경기 기록이 없습니다.</h3><p>멤버·조회 기간·이름 검색을 바꿔 주세요.</p></div>';
    const chosen = groups.find(row => row.key === selectedKey);
    $('#personal-details').innerHTML = chosen ? `<div class="personal-detail-heading"><h3>${chosen.names.map(esc).join(' · ')} · 경기 ${chosen.games}건</h3><button class="text-button" id="personal-collapse">접기</button></div>${[...chosen.records].sort((a, b) => b.date.localeCompare(a.date) || a.round - b.round).map(record => {
      const labels = Object.fromEntries([...Object.entries(nameMap), ...Object.entries(record.guests || {}).map(([id, guest]) => [id, guest.name])]);
      const team = ids => ids.map(id => esc(labels[id] || id)).join(' · ');
      return `<article class="history-card"><span>${record.date} · ${record.round}라운드 · ${record.court === 1 ? '안쪽' : '바깥쪽'} 코트</span><div>${team(record.teamA)} <strong>${record.scoreA} : ${record.scoreB}</strong> ${team(record.teamB)}</div><button class="text-button" data-personal-date="${record.date}">대진표 보기 →</button></article>`;
    }).join('')}` : '';
  }
  element.addEventListener('change', event => {
    if (event.target.id === 'personal-player') { selected = event.target.value; query = ''; $('#personal-search').value = ''; }
    else if (event.target.id === 'personal-period') period = event.target.value;
    else if (event.target.id === 'archive-set') { datasetId = event.target.value; query = ''; $('#personal-search').value = ''; }
    else return;
    selectedKey = ''; $('#personal-error').textContent = ''; render();
  });
  element.addEventListener('input', event => { if (event.target.id === 'personal-search') { query = event.target.value; selectedKey = ''; render(); } });
  element.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.personalMode) { mode = button.dataset.personalMode; selectedKey = ''; query = ''; $('#personal-search').value = ''; }
    else if (button.dataset.relationKey) { selectedKey = selectedKey === button.dataset.relationKey ? '' : button.dataset.relationKey; }
    else if (button.id === 'personal-collapse') selectedKey = '';
    else if (button.id === 'personal-clear') { query = ''; selectedKey = ''; $('#personal-search').value = ''; }
    else if (button.id === 'personal-apply') {
      const nextStart = $('#personal-start').value, nextEnd = $('#personal-end').value;
      if (!validDate(nextStart) || !validDate(nextEnd) || nextStart > nextEnd) { $('#personal-error').textContent = '시작일과 종료일을 올바른 순서로 선택해 주세요.'; return; }
      start = nextStart; end = nextEnd; selectedKey = ''; $('#personal-error').textContent = '';
    } else if (button.dataset.personalDate) { openDate(button.dataset.personalDate); return; }
    else return;
    render();
    if (selectedKey) $('#personal-details').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  render();
  return {
    render,
    selectPlayer(id, value) { selected = id; if (typeof value === 'object') { period = 'custom'; start = value.start; end = value.end; $('#personal-start').value = start; $('#personal-end').value = end; } else period = value; mode = 'partners'; query = ''; selectedKey = ''; $('#personal-search').value = ''; render(); },
    selectArchive(id, value) { selected = id; datasetId = value; mode = 'archive'; query = ''; selectedKey = ''; $('#personal-search').value = ''; render(); },
    setHistory(sets) { history = sets; render(); },
    setHistoryStatus(text) { historyStatus = text; render(); },
  };
}
