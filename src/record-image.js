import { validResult } from './model.js';
import { datedHistory, rankingWithHistory } from './history-stats.js';
import { withinPeriod, periodLabel } from './periods.js';
import { openImagePages } from './schedule-image.js';

export function recordImagePages(records, players, value, date, history = []) {
  const scoped = records.filter(record => validResult(record) && withinPeriod(value, record.date));
  const daily = scoped.filter(record => record.date === date);
  if (!withinPeriod(value, date)) throw new Error('선택한 기간 안의 모임 날짜를 선택해 주세요.');
  if (!daily.length && !datedHistory(history, date, records).length) throw new Error('선택한 기간 안에서 점수가 입력된 모임을 선택해 주세요.');
  const cumulative = scoped.filter(record => record.date <= date);
  const asOf = date;
  const key = typeof value === 'object' ? `${value.start}_${value.end}` : value;
  const rows = (input, period) => rankingWithHistory(input, players, period, history.filter(set => !set.cutoff || set.cutoff <= date)).filter(player => player.games).map(({ id, name, shortName, rank, games, wins, draws, losses, points, scored, conceded, difference, winRate }) => ({ id, name: shortName || name, rank, games, wins, draws, losses, points, scored, conceded, difference, winRate }));
  return [
    { kind: 'daily', label: '당일 결과', title: `GDR ${date} 당일 결과`, date, asOf: date, rows: rows(daily, date), filename: `GDR-${date}-results.png` },
    { kind: 'cumulative', label: '누적 순위', title: `GDR ${periodLabel(value)} 순위`, date, asOf, rows: rows(cumulative, value), filename: `GDR-${key}-ranking-${asOf}.png` },
  ];
}

export async function renderRecordImage(page) {
  const columns = page.kind === 'daily'
    ? [['이름', 'name', 240], ['승', 'wins', 160], ['무', 'draws', 160], ['패', 'losses', 160], ['승점', 'points', 200], ['득', 'scored', 190], ['실', 'conceded', 190], ['득실차', 'difference', 220]]
    : [['순위', 'rank', 120], ['이름', 'name', 230], ['포인트', 'points', 170], ['게임수', 'games', 170], ['승', 'wins', 120], ['무', 'draws', 120], ['패', 'losses', 120], ['승률', 'winRate', 170], ['득', 'scored', 170], ['실', 'conceded', 170], ['득실차', 'difference', 220]];
  const margin = 40, width = columns.reduce((sum, column) => sum + column[2], margin * 2);
  const headerY = 226, rowHeight = 74, height = headerY + rowHeight * (page.rows.length + 1) + 122;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('이미지를 만들 수 없습니다.');
  const text = (value, x, y, size = 32, color = '#34213f', weight = 500, maxWidth = Infinity) => {
    ctx.font = `${weight} ${size}px "Noto Sans KR", system-ui, sans-serif`; ctx.fillStyle = color; ctx.textAlign = 'center';
    if (Number.isFinite(maxWidth)) ctx.fillText(String(value), x, y, maxWidth); else ctx.fillText(String(value), x, y);
  };
  ctx.fillStyle = '#faf8fc'; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#672883'; ctx.fillRect(0, 0, width, 190);
  text('GDR TENNIS CLUB', width / 2, 54, 27, '#dcea56', 700);
  text(page.title.replace(/^GDR /, ''), width / 2, 115, 43, '#ffffff', 700, width - 80);
  text(`${page.asOf} 기준 · 경기한 회원 ${page.rows.length}명`, width / 2, 158, 25, '#e9ddef');
  let x = margin;
  for (const [label, , cellWidth] of columns) {
    ctx.fillStyle = '#672883'; ctx.fillRect(x, headerY, cellWidth, rowHeight);
    text(label, x + cellWidth / 2, headerY + 48, 30, '#ffffff', 700);
    x += cellWidth;
  }
  page.rows.forEach((row, index) => {
    let x = margin; const y = headerY + rowHeight * (index + 1);
    for (const [, key, cellWidth] of columns) {
      ctx.fillStyle = key === 'name' ? '#fff4d8' : index % 2 ? '#f4eef8' : '#ffffff'; ctx.fillRect(x, y, cellWidth, rowHeight);
      ctx.strokeStyle = '#e7ddec'; ctx.lineWidth = 1; ctx.strokeRect(x, y, cellWidth, rowHeight);
      const value = key === 'winRate' ? `${row[key]}%` : key === 'difference' && row[key] > 0 ? `+${row[key]}` : row[key];
      text(value, x + cellWidth / 2, y + 48, key === 'name' ? 34 : 32, key === 'points' ? '#b44f36' : '#34213f', ['name', 'points', 'rank'].includes(key) ? 700 : 500, cellWidth - 28);
      x += cellWidth;
    }
  });
  text('승 3점 · 무 1점 · 패 0점 / 같은 승점은 공동순위', width / 2, height - 65, 23, '#77837a');
  text('실제 경기·날짜별 개인 집계 기준 · 게스트는 회원 순위에서 제외', width / 2, height - 29, 22, '#77837a');
  const blob = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('이미지 생성에 실패했습니다.')), 'image/png'));
  canvas.width = 1; canvas.height = 1;
  return new File([blob], page.filename, { type: 'image/png' });
}

export async function openRecordImages(records, players, value, date, history = []) {
  const pages = recordImagePages(structuredClone(records), players, value, date, history);
  return openImagePages(pages, renderRecordImage, '기록 이미지 2장', true);
}
