import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { toFirestoreValue, fromFirestoreValue } from './firestore-values.js';

const option = key => process.argv[process.argv.indexOf(key) + 1];
const path = process.argv.includes('--plan') ? option('--plan') : 'output/history/firestore-import-plan.json';
const receiptPath = process.argv.includes('--receipt') ? option('--receipt') : 'output/history/firestore-import-receipt.json';
const plan = JSON.parse(await readFile(path, 'utf8'));
if (plan.projectId !== 'guldari' || plan.databaseId !== '(default)' || plan.documents.some(document => !document.path.startsWith('clubs/gdr/'))) throw new Error('Import target must be guldari/(default)/clubs/gdr.');
if (new Set(plan.documents.map(document => document.path)).size !== plan.documents.length) throw new Error('Duplicate import paths.');
const cli = option('--firebase-cli'), email = option('--account');
if (!process.argv.includes('--firebase-cli') || !process.argv.includes('--account')) throw new Error('--firebase-cli directory and --account email are required.');
const require = createRequire(import.meta.url), auth = require(`${cli}/lib/auth.js`);
const account = auth.getAllAccounts().find(account => account.user.email === email);
if (!account) throw new Error('Requested Firebase CLI account is not signed in.');
// Reuse the signed-in Firebase CLI identity; never print or persist credentials.
const token = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform']);
const base = 'projects/guldari/databases/(default)/documents';
const request = async (method, url, body) => {
  const response = await fetch(`https://firestore.googleapis.com/v1/${url}`, { method, headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 404) return null;
  const result = await response.json();
  if (!response.ok) throw new Error(`Firestore ${response.status}: ${result.error?.status || 'request failed'}`);
  return result;
};
const existing = await Promise.all(plan.documents.map(async document => [document.path, await request('GET', `${base}/${document.path}`)]));
const updates = [];
for (const [path, raw] of existing) {
  const entry = plan.documents.find(document => document.path === path);
  if (raw) {
    const data = Object.fromEntries(Object.entries(raw.fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)]));
    for (const field of entry.timestamps) delete data[field];
    if (!isDeepStrictEqual(data, entry.data)) throw new Error(`Existing document differs; no records overwritten: ${path}`);
  } else updates.push(entry);
}
console.log(JSON.stringify({ project: plan.projectId, planned: plan.documents.length, alreadyPresent: existing.length - updates.length, toCreate: updates.length, mode: process.argv.includes('--apply') ? 'apply' : 'read-only-preflight' }));
if (!process.argv.includes('--apply')) process.exit(0);
if (updates.length) {
  const writes = updates.map(entry => ({ update: { name: `${base}/${entry.path}`, fields: toFirestoreValue(entry.data).mapValue.fields }, currentDocument: { exists: false }, ...(entry.timestamps.length ? { updateTransforms: entry.timestamps.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) } : {}) }));
  // One atomic create-only commit: concurrent writes or retries cannot overwrite data.
  const result = await request('POST', `${base}:commit`, { writes });
  if (result.writeResults?.length !== writes.length) throw new Error('Unexpected commit result; read back before retrying.');
}
const verification = await Promise.all(plan.documents.map(async entry => {
  const raw = await request('GET', `${base}/${entry.path}`);
  if (!raw) throw new Error(`Missing imported document: ${entry.path}`);
  const data = Object.fromEntries(Object.entries(raw.fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)]));
  for (const field of entry.timestamps) delete data[field];
  if (!isDeepStrictEqual(data, entry.data)) throw new Error(`Read-back mismatch: ${entry.path}`);
  return { path: entry.path, updateTime: raw.updateTime };
}));
await writeFile(receiptPath, JSON.stringify({ projectId: plan.projectId, contentDigest: plan.contentDigest, verifiedAt: new Date().toISOString(), created: updates.length, verified: verification }, null, 2));
console.log(JSON.stringify({ result: 'verified', created: updates.length, verified: verification.length }));
