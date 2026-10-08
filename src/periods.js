import { quarter, validDate } from './model.js';

export function halfYear(date) {
  if (!validDate(date)) throw new Error('날짜를 확인해 주세요.');
  return `${date.slice(0, 4)}-H${Number(date.slice(5, 7)) <= 6 ? 1 : 2}`;
}

export function withinPeriod(value, date) {
  if (typeof value === 'object') return !!value && validDate(value.start) && validDate(value.end) && value.start <= value.end && date >= value.start && date <= value.end;
  if (value === 'all') return true;
  if (/^\d{4}-Q[1-4]$/.test(value)) return quarter(date) === value;
  if (/^\d{4}-H[12]$/.test(value)) return date.slice(0, 4) === value.slice(0, 4) && Math.ceil(Number(date.slice(5, 7)) / 6) === Number(value.at(-1));
  return date === value;
}

export function periodLabel(value) {
  if (typeof value === 'object') return `${value.start.replaceAll('-', '.')}–${value.end.replaceAll('-', '.')}`;
  if (value === 'all') return '전체 누적';
  if (/^\d{4}-Q[1-4]$/.test(value)) return `${value.slice(0, 4)}년 ${value.at(-1)}분기`;
  if (/^\d{4}-H[12]$/.test(value)) return `${value.slice(0, 4)}년 ${value.at(-1) === '1' ? '상반기' : '하반기'}`;
  return value;
}

export function quarterBounds(value) {
  const year = Number(value.slice(0, 4)), month = (Number(value.at(-1)) - 1) * 3;
  return { start: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10), endBefore: new Date(Date.UTC(year, month + 3, 1)).toISOString().slice(0, 10) };
}
