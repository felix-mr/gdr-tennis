import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { toFirestoreValue, fromFirestoreValue } from './firestore-values.js';

const option = key => process.argv.includes(key) ? process.argv[process.argv.indexOf(key) + 1] : undefined;
const cli = option('--firebase-cli'), email = option('--account');
if (!cli || !email) throw new Error('--firebase-cli and --account are required.');
const require = createRequire(import.meta.url), auth = require(`${cli}/lib/auth.js`);
const account = auth.getAllAccounts().find(entry => entry.user.email === email);
if (!account) throw new Error('Requested Firebase account is not signed in.');
const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
const base = 'projects/guldari/databases/(default)/documents';
const request = async (method, path, body) => {
  const response = await fetch(`https://firestore.googleapis.com/v1/${path}`, { method, headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 404) return null;
  const data = await response.json(); if (!response.ok) throw new Error(`Firestore ${response.status}: ${data.error?.status}`); return data;
};
const decode = raw => Object.fromEntries(Object.entries(raw.fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)]));
const path = `${base}/clubs/gdr/historySets/career-2026-06`;
const original = await request('GET', path);
if (!original) throw new Error('Missing career source.');
const source = decode(original);
if (source.kind !== 'individual-aggregate' || source.cutoff !== '2026-06' || source.rows.length !== 28) throw new Error('Unexpected career source.');
const update = { contributesToRatings: true, ratingRole: 'prior-only-pre-quarter', maxPriorWeight: 0.08 };
const changed = Object.entries(update).some(([key, value]) => !isDeepStrictEqual(source[key], value));
console.log(JSON.stringify({ project: 'guldari', source: 'career-2026-06', people: 28, changed, mode: process.argv.includes('--apply') ? 'apply' : 'read-only-preflight' }));
if (!process.argv.includes('--apply')) process.exit(0);
if (changed) {
  const writes = [{ update: { name: path, fields: toFirestoreValue(update).mapValue.fields }, updateMask: { fieldPaths: Object.keys(update) }, currentDocument: { updateTime: original.updateTime } }];
  const receiptPath = `${base}/clubs/gdr/historyImports/career-prior-v1`, receipt = await request('GET', receiptPath);
  if (receipt && decode(receipt).source !== 'career-2026-06') throw new Error('Unexpected prior receipt.');
  if (!receipt) writes.push({ update: { name: receiptPath, fields: toFirestoreValue({ source: 'career-2026-06', role: update.ratingRole, maxPriorWeight: 0.08, originalRowsPreserved: true }).mapValue.fields }, currentDocument: { exists: false }, updateTransforms: [{ fieldPath: 'activatedAt', setToServerValue: 'REQUEST_TIME' }] });
  await request('POST', `${base}:commit`, { writes });
}
const verified = decode(await request('GET', path));
if (!isDeepStrictEqual(source.rows, verified.rows) || Object.entries(update).some(([key, value]) => !isDeepStrictEqual(verified[key], value))) throw new Error('Prior read-back mismatch.');
console.log(JSON.stringify({ verified: true, originalRowsPreserved: true }));
