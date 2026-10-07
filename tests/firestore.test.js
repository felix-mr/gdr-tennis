import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { encodeSession, decodeSession } from '../src/session-codec.js';
import { validateSession } from '../src/model.js';
import { generateSchedule, allocateForWindow } from '../src/scheduler.js';
import players from '../data/players.json' with { type: 'json' };

test('Firestore public entry contract', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({ projectId: 'demo-gdr', firestore: { host, port: Number(port), rules: await readFile(new URL('../firebase/firestore.rules', import.meta.url), 'utf8') } });
  try {
    const db = env.unauthenticatedContext().firestore(), base = 'clubs/gdr';
    const ids = players.map(p => p.id), lockedPairs = [[ids[0], ids[1]]], generated = generateSchedule(ids, allocateForWindow(ids, 4, {}, lockedPairs), { attempts: 40, lockedPairs });
    const session = encodeSession({ schemaVersion: 1, date: '2026-10-07', participantIds: ids, fixedPlayerIds: ids, matchMap: generated.matchMap, partnerRepeats: generated.partnerRepeats, lockedPairs, startTime: '19:00', endTime: '21:00', roundMinutes: 30, createdAt: serverTimestamp() });
    const scheduleRef = doc(db, `${base}/sessions/${session.date}`);
    await t.test('anonymous list and valid schedule creation', async () => {
      await assertSucceeds(getDocs(collection(db, `${base}/sessions`)));
      await assertSucceeds(getDocs(collection(db, `${base}/matchResults`)));
      await assertSucceeds(setDoc(scheduleRef, session));
      const saved = decodeSession((await getDoc(scheduleRef)).data());
      assert.deepEqual(saved.lockedPairs, lockedPairs);
      validateSession(saved, ids);
    });
    await t.test('schedule and team modifications/deletion are denied', async () => {
      await assertFails(updateDoc(scheduleRef, { startTime: '09:00' }));
      await assertFails(deleteDoc(scheduleRef));
    });
    await t.test('unknown player, double appearance and unexpected fields are denied', async () => {
      const bad = structuredClone({ ...session, createdAt: null });
      bad.date = '2026-10-08'; bad.participantIds[0] = 'unknown'; bad.fixedPlayerIds = [...bad.participantIds]; bad.createdAt = serverTimestamp();
      await assertFails(setDoc(doc(db, `${base}/sessions/${bad.date}`), bad));
      const doubled = { ...session, date: '2026-10-09', matchMap: { ...session.matchMap, 'r1-c2': { ...session.matchMap['r1-c2'], teamA: session.matchMap['r1-c1'].teamA } } };
      await assertFails(setDoc(doc(db, `${base}/sessions/${doubled.date}`), doubled));
      await assertFails(setDoc(doc(db, `${base}/sessions/2026-10-10`), { ...session, date: '2026-10-10', unknownField: 'bad' }));
    });
    const resultRef = doc(db, `${base}/matchResults/2026-10-07_r1-c1`);
    const result = { date: '2026-10-07', matchId: 'r1-c1', scoreA: 6, scoreB: 4, outcome: 'teamA', revision: 1, updatedAt: serverTimestamp() };
    await t.test('score validation and valid anonymous creation', async () => {
      await assertFails(setDoc(resultRef, { ...result, scoreA: -1 }));
      await assertFails(setDoc(resultRef, { ...result, outcome: 'teamB' }));
      await assertFails(setDoc(resultRef, { ...result, scoreA: 6.5 }));
      await assertSucceeds(setDoc(resultRef, result));
    });
    await t.test('revision guards stale updates; 0:0 remains valid draw', async () => {
      await assertFails(setDoc(resultRef, { ...result, scoreA: 0, scoreB: 0, outcome: 'draw', revision: 1 }));
      await assertSucceeds(setDoc(resultRef, { ...result, scoreA: 0, scoreB: 0, outcome: 'draw', revision: 2 }));
      await assertFails(setDoc(resultRef, { ...result, revision: 2 }));
      await assertFails(deleteDoc(resultRef));
    });
    await t.test('nonexistent match and unrelated paths are denied', async () => {
      await assertFails(setDoc(doc(db, `${base}/matchResults/2026-10-07_r8-c1`), { ...result, matchId: 'r8-c1' }));
      await assertFails(setDoc(doc(db, 'users/somebody'), { name: 'somebody' }));
    });
  } finally { await env.cleanup(); }
});
