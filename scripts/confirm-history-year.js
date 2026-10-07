import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { toFirestoreValue, fromFirestoreValue } from './firestore-values.js';
import { normalizeDailyRows } from '../src/history-stats.js';

const option = key => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : undefined;
const cli = option('--firebase-cli'), email = option('--account');
if (!cli || !email || option('--year') !== '2026') throw new Error('--firebase-cli, --account and --year 2026 are required.');
const require = createRequire(import.meta.url), auth = require(`${cli}/lib/auth.js`);
const account = auth.getAllAccounts().find(account => account.user.email === email);
if (!account) throw new Error('Requested Firebase account is not signed in.');
const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
const base = 'projects/guldari/databases/(default)/documents';
const request = async (method, path, body) => {
  const response = await fetch(`https://firestore.googleapis.com/v1/${path}`, { method, headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 404) return null;
  const data = await response.json(); if (!response.ok) throw new Error(`Firestore ${response.status}: ${data.error?.status}`); return data;
};
const decode = raw => Object.fromEntries(Object.entries(raw.fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)]));
const plan = JSON.parse(await readFile('output/history/firestore-import-plan.json', 'utf8'));
const paths = plan.documents.filter(entry => entry.path.includes('/historySets/weekly-year-unknown-')).map(entry => entry.path);
if (paths.length !== 7) throw new Error('Expected seven confirmed daily snapshots.');
const entries = await Promise.all(paths.map(async path => {
  const raw = await request('GET', `${base}/${path}`); if (!raw) throw new Error('Missing original snapshot');
  const original = decode(raw), [month, day] = original.monthDay.split('/').map(Number);
  if (original.year !== null && original.year !== 2026) throw new Error('Unexpected existing year');
  const cutoff = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const data = { year: 2026, cutoff, period: `2026-Q${Math.ceil(month / 3)}`, datePrecision: 'day', status: 'date-confirmed', contributesToLiveRanking: true, contributesToRatings: false, title: `2026년 ${month}/${day} 당일 결과`, note: '사용자가 2026년 기록으로 확정했습니다. 날짜별 개인 집계를 기간 통계에 반영하며, 실제 경기 기록이 있는 날은 중복 합산하지 않습니다. 승점·경기 수·득실차는 승무패·득실에서 계산하고 원본 값은 별도로 보존합니다.', dateConfirmation: { confirmedYear: 2026, authority: 'user-confirmed', originalYear: null, originalDatePrecision: 'unconfirmed' } };
  data.normalizedRows = normalizeDailyRows({ ...original, ...data });
  return { path, raw, original, data };
}));
const updates = entries.filter(entry => Object.entries(entry.data).some(([key, value]) => !isDeepStrictEqual(entry.original[key], value)));
console.log(JSON.stringify({ project: 'guldari', year: 2026, confirmedDates: entries.map(entry => entry.data.cutoff), snapshots: entries.length, normalizedPeople: entries.reduce((sum, entry) => sum + entry.data.normalizedRows.length, 0), toUpdate: updates.length, mode: process.argv.includes('--apply') ? 'apply' : 'read-only-preflight' }));
if (!process.argv.includes('--apply')) process.exit(0);
if (updates.length) {
  const writes = updates.map(entry => ({ update: { name: `${base}/${entry.path}`, fields: toFirestoreValue(entry.data).mapValue.fields }, updateMask: { fieldPaths: Object.keys(entry.data) }, currentDocument: { updateTime: entry.raw.updateTime }, updateTransforms: [{ fieldPath: 'dateConfirmedAt', setToServerValue: 'REQUEST_TIME' }] }));
  const receiptPath = `${base}/clubs/gdr/historyImports/year-confirmation-2026`;
  const receipt = await request('GET', receiptPath);
  if (receipt && (decode(receipt).year !== 2026 || !decode(receipt).originalRowsPreserved)) throw new Error('Confirmation receipt differs; inspect before changing.');
  if (!receipt) writes.push({ update: { name: receiptPath, fields: toFirestoreValue({ schemaVersion: 1, year: 2026, authority: 'user-confirmed', paths, snapshots: 7, normalizedPeople: entries.reduce((sum, entry) => sum + entry.data.normalizedRows.length, 0), originalRowsPreserved: true }).mapValue.fields }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'confirmedAt', setToServerValue: 'REQUEST_TIME' }] });
  await request('POST', `${base}:commit`, { writes });
}
for (const entry of entries) {
  const data = decode(await request('GET', `${base}/${entry.path}`));
  if (!isDeepStrictEqual(data.rows, entry.original.rows)) throw new Error('Original rows changed');
  for (const [key, value] of Object.entries(entry.data)) if (!isDeepStrictEqual(data[key], value)) throw new Error('Confirmation read-back mismatch');
}
await writeFile('output/history/year-confirmation-receipt.json', JSON.stringify({ year: 2026, project: 'guldari', updated: updates.length, verified: entries.length, originalRowsPreserved: true, normalizedPeople: entries.reduce((sum, entry) => sum + entry.data.normalizedRows.length, 0) }, null, 2));
console.log(JSON.stringify({ verified: entries.length, originalRowsPreserved: true }));
