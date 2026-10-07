import { matchesName } from './search.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const issuesFor = row => (row.issues || []).map(issue => typeof issue === 'string' ? issue : issue.field === 'identity' ? '인물 잠정 연결' : `${({ points: '승점', games: '경기 수', difference: '득실차', winRate: '승률' })[issue.field] || issue.field}: 원본 ${issue.provided} / 계산 ${issue.expected}`).join(' · ');
export function mountArchiveView({ element, players, openPlayer }) {
  let sets = [], selected = 'career-2026-06', query = '', metric = 'points', status = '이전 기록 불러오는 중…';
  const $ = selector => element.querySelector(selector);
  element.innerHTML = `<div class="archive-overview-controls"><label for="history-dataset">이전 기록 선택<select id="history-dataset"></select></label><div class="record-search"><label class="sr-only" for="history-search">이전 기록 이름 검색</label><input type="search" id="history-search" placeholder="이름 검색" autocomplete="off"><button id="history-clear" class="text-button" hidden>지우기</button></div></div><p id="history-note" class="personal-note" role="status"></p><section class="history-chart-panel"><div class="history-chart-heading"><div><span class="section-label">이전 집계 · 전체 멤버</span><h3 id="history-chart-title"></h3></div><div class="history-metrics" role="group" aria-label="그래프 기준"><button data-history-metric="points" aria-pressed="true">승점</button><button data-history-metric="winRate" aria-pressed="false">승률</button><button data-history-metric="games" aria-pressed="false">경기 수</button></div></div><p class="hint">이름을 누르면 해당 멤버의 이전 기록을 확인합니다.</p><div id="history-chart" class="history-chart"></div></section><details class="history-table-details"><summary>원본 표 전체 보기</summary><div class="rank-panel"><div class="panel-top"><h3 id="history-title"></h3><button id="history-csv" class="text-button" disabled>CSV 내려받기 ↓</button></div><p class="table-scroll-hint">좌우로 넘겨 전체 기록을 확인하세요.</p><div class="table-scroll" tabindex="0" role="region" aria-label="이전 기록 원본 집계"><table><caption class="sr-only">이전 자료의 원본 집계</caption><thead><tr><th>순위</th><th>이름</th><th>승점</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>승률</th><th>득</th><th>실</th><th>득실차</th><th>확인</th></tr></thead><tbody id="history-rows"></tbody></table></div><p class="table-note">원본 값을 표시합니다. 없는 항목은 —, 경기 수가 없으면 승·무·패 합계로 표시합니다. 다른 집계와 새 경기에 중복 합산하지 않습니다.</p></div></details><div id="history-issues" class="history-review-list"></div>`;
  const datasets = () => sets.filter(set => ['individual-aggregate', 'daily-individual-aggregate'].includes(set.kind)).sort((a, b) => Number(a.status === 'superseded') - Number(b.status === 'superseded') || Number(!a.id.startsWith('career-')) - Number(!b.id.startsWith('career-')) || (b.cutoff || '').localeCompare(a.cutoff || ''));
  const names = () => Object.fromEntries([...players.map(player => [player.id, player.name]), ...sets.filter(set => set.id === 'career-2026-06').flatMap(set => set.rows.map(row => [row.playerId, row.name]))]);
  const checked = (row, dataset) => row.issues?.length || !row.playerId || row.identityStatus === 'tentative-user-guidance' || dataset.datePrecision === 'unconfirmed' || dataset.status === 'superseded';
  const displayRows = () => {
    const dataset = datasets().find(set => set.id === selected), nameMap = names();
    return dataset?.rows.map(row => {
      const name = nameMap[row.playerId] || row.name, stats = row.stats;
      const games = stats.games ?? stats.wins + stats.draws + stats.losses;
      const rate = stats.winRate !== undefined ? `${Math.round(stats.winRate * 100)}%` : games ? `${Math.round(100 * stats.wins / games)}%` : '—';
      return { row, name, values: [stats.rank ?? '—', name, stats.points ?? '—', games, stats.wins, stats.draws, stats.losses, rate, stats.scored ?? '—', stats.conceded ?? '—', stats.difference ?? '—', checked(row, dataset) ? '확인 필요' : '원본 집계'] };
    }).filter(item => matchesName(item.name, query) || matchesName(item.row.name, query)) || [];
  };
  const render = () => {
    const options = datasets();
    if (!options.some(set => set.id === selected)) selected = options[0]?.id || '';
    $('#history-dataset').innerHTML = options.map(set => `<option value="${esc(set.id)}">${esc(set.title)}</option>`).join('') || '<option>기록 없음</option>';
    $('#history-dataset').value = selected; $('#history-dataset').disabled = !options.length;
    const dataset = options.find(set => set.id === selected), rows = displayRows();
    $('#history-title').textContent = dataset?.title || '이전 기록';
    $('#history-chart-title').textContent = dataset?.title || '이전 기록';
    element.querySelectorAll('[data-history-metric]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.historyMetric === metric)));
    const index = { points: 2, winRate: 7, games: 3 }[metric];
    const chartRows = [...rows].sort((a, b) => (parseFloat(b.values[index]) || 0) - (parseFloat(a.values[index]) || 0));
    const max = metric === 'winRate' ? 100 : Math.max(1, ...chartRows.map(item => Number(item.values[index]) || 0));
    const label = { points: '승점', winRate: '승률', games: '경기 수' }[metric];
    $('#history-chart').innerHTML = chartRows.map(({ row, name, values }) => {
      const value = parseFloat(values[index]) || 0, width = Math.max(0, Math.min(100, value / max * 100));
      const warning = checked(row, dataset);
      const tag = row.playerId ? 'button' : 'div';
      return `<${tag} class="history-chart-row" ${row.playerId ? `data-history-player="${esc(row.playerId)}"` : ''}><span class="history-chart-name">${esc(name)}${warning ? '<small>확인 필요</small>' : ''}</span><span class="history-chart-track" aria-hidden="true"><span style="width:${width}%"></span></span><strong>${esc(values[index])}${metric === 'points' && values[index] !== '—' ? '점' : metric === 'games' ? '경기' : ''}</strong><span class="sr-only">${label}</span></${tag}>`;
    }).join('') || `<p class="records-pending">${dataset ? '검색에 맞는 기록이 없습니다.' : esc(status)}</p>`;
    $('#history-note').textContent = dataset ? `${dataset.datePrecision === 'unconfirmed' ? '연도 확인 필요 · ' : dataset.status === 'superseded' ? '정정 전 원본 · ' : ''}${rows.length}명 / 전체 ${dataset.rows.length}명 · ${dataset.note || '각 원본 기준일의 집계입니다. 새 경기 기록과 합산하지 않습니다.'}` : status;
    $('#history-clear').hidden = !query; $('#history-csv').disabled = !rows.length;
    $('#history-rows').innerHTML = rows.map(({ row, name, values }) => `<tr>${values.map((value, index) => `<td${index === 2 ? ' class="points"' : ''}>${index === 1 && row.playerId ? `<button class="name-button" data-history-player="${esc(row.playerId)}">${esc(name)}</button>` : index === 11 ? `<span class="archive-badge ${checked(row, dataset) ? 'review' : ''}">${esc(value)}</span>` : esc(value)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="12" class="records-pending">${dataset ? '검색에 맞는 기록이 없습니다.' : esc(status)}</td></tr>`;
    const review = rows.filter(({ row }) => row.issues?.length || !row.playerId || row.identityStatus === 'tentative-user-guidance');
    $('#history-issues').innerHTML = review.length ? `<details class="archive-unresolved"><summary>확인이 필요한 항목 ${review.length}건</summary>${review.map(({ row, name }) => `<p><strong>${esc(name)}</strong> · ${esc(issuesFor(row) || '인물 확인 필요')}</p>`).join('')}</details>` : '';
  };
  element.addEventListener('change', event => { if (event.target.id === 'history-dataset') { selected = event.target.value; render(); } });
  element.addEventListener('input', event => { if (event.target.id === 'history-search') { query = event.target.value; render(); } });
  element.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.historyMetric) { metric = button.dataset.historyMetric; render(); }
    else if (button.id === 'history-clear') { query = ''; $('#history-search').value = ''; render(); }
    else if (button.dataset.historyPlayer) openPlayer(button.dataset.historyPlayer, selected);
    else if (button.id === 'history-csv') {
      const rows = [['순위', '이름', '승점', '경기', '승', '무', '패', '승률', '득', '실', '득실차', '확인'], ...displayRows().map(item => item.values)];
      const text = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
      const url = URL.createObjectURL(new Blob(['\uFEFF' + text], { type: 'text/csv;charset=utf-8' })), link = document.createElement('a');
      link.href = url; link.download = `GDR-이전기록-${selected}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  render();
  return { setHistory(next) { sets = next; render(); }, setHistoryStatus(next) { status = next; render(); } };
}
