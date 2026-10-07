import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { encodeSession, encodeRounds, decodeSession } from '../src/session-codec.js';
import { validateSession } from '../src/model.js';
import { generateSchedule, allocateForWindow } from '../src/scheduler.js';
import periods from '../data/periods.json' with { type: 'json' };

test('Firestore public entry contract', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({ projectId: 'demo-gdr', firestore: { host, port: Number(port), rules: await readFile(new URL('../firebase/firestore.rules', import.meta.url), 'utf8') } });
  try {
    const db = env.unauthenticatedContext().firestore(), base = 'clubs/gdr';
    const ids = periods.find(period => period.id === '2026-Q4').memberIds, lockedPairs = [[ids[0], ids[1]]];
    const generated = generateSchedule(ids, allocateForWindow(ids, 4, lockedPairs), { attempts: 40, lockedPairs });
    const session = { schemaVersion: 1, date: '2026-10-07', participantIds: ids, fixedPlayerIds: ids, matchMap: generated.matchMap, partnerRepeats: generated.partnerRepeats, lockedPairs, startTime: '19:00', endTime: '21:00', roundMinutes: 30, createdAt: serverTimestamp() };
    const scheduleRef = doc(db, base + '/sessions/' + session.date);
    const save = source => {
      const batch = writeBatch(db);
      batch.set(doc(db, base + '/sessions/' + source.date), encodeSession(source));
      for (const [round, data] of Object.entries(encodeRounds(source))) batch.set(doc(db, base + '/sessions/' + source.date + '/rounds/' + round), data);
      return batch.commit();
    };
    const load = async date => decodeSession((await getDoc(doc(db, base + '/sessions/' + date))).data(), (await getDocs(collection(db, base + '/sessions/' + date + '/rounds'))).docs.map(doc => doc.data()));
    await t.test('anonymous list, atomic header/round storage and verified reconstruction', async () => {
      await assertSucceeds(getDocs(collection(db, base + '/sessions')));
      await assertSucceeds(getDocs(collection(db, base + '/matchResults')));
      await assertSucceeds(save(session));
      const saved = await load(session.date);
      assert.deepEqual(saved.lockedPairs, lockedPairs);
      assert.deepEqual(saved.matchMap, session.matchMap);
      validateSession(saved, ids);
    });
    await t.test('schedule and round modifications/deletion are denied', async () => {
      await assertFails(updateDoc(scheduleRef, { startTime: '09:00' }));
      await assertFails(deleteDoc(scheduleRef));
      await assertFails(updateDoc(doc(db, base + '/sessions/' + session.date + '/rounds/1'), { round: 2 }));
      await assertFails(deleteDoc(doc(db, base + '/sessions/' + session.date + '/rounds/1')));
    });
    await t.test('unknown player, double appearance and unexpected fields are denied atomically', async () => {
      const bad = structuredClone({ ...session, createdAt: null });
      bad.date = '2026-10-08'; bad.participantIds[0] = 'unknown'; bad.fixedPlayerIds = [...bad.participantIds]; bad.createdAt = serverTimestamp();
      await assertFails(save(bad));
      assert.equal((await getDoc(doc(db, base + '/sessions/' + bad.date))).exists(), false);
      const doubled = { ...session, date: '2026-10-09', matchMap: { ...session.matchMap, 'r1-c2': { ...session.matchMap['r1-c2'], teamA: session.matchMap['r1-c1'].teamA } } };
      await assertFails(save(doubled));
      assert.equal((await getDoc(doc(db, base + '/sessions/' + doubled.date))).exists(), false);
      await assertFails(save({ ...session, date: '2026-10-10', unknownField: 'bad' }));
    });
    await t.test('extended windows and over-four games; invalid times and overrun denied', async () => {
      for (const [date, startTime, endTime, rounds] of [['2026-10-18', '19:00', '22:00', 6], ['2026-10-25', '07:00', '13:00', 12]]) {
        const generated = generateSchedule(ids, allocateForWindow(ids, rounds), { attempts: 30 });
        const extended = { ...session, date, startTime, endTime, lockedPairs: [], matchMap: generated.matchMap, partnerRepeats: generated.partnerRepeats };
        await assertSucceeds(save(extended));
        validateSession(await load(date), ids);
      }
      const four = ids.slice(0, 4), long = generateSchedule(four, allocateForWindow(four, 6), { attempts: 20 });
      const late = { ...session, date: '2026-11-01', participantIds: four, fixedPlayerIds: four, matchMap: long.matchMap, lockedPairs: [], partnerRepeats: long.partnerRepeats };
      await assertFails(save(late));
      await assertSucceeds(save({ ...late, endTime: '22:00' }));
      for (const [startTime, endTime] of [['19:00', '18:00'], ['25:00', '22:00'], ['19:15', '22:00']]) await assertFails(save({ ...session, date: '2026-11-08', startTime, endTime }));
      const maximum = generateSchedule(four, allocateForWindow(four, 47), { attempts: 2 });
      const longest = { ...late, date: '2026-11-15', startTime: '00:00', endTime: '23:30', matchMap: maximum.matchMap, partnerRepeats: maximum.partnerRepeats };
      await assertSucceeds(save(longest));
      validateSession(await load(longest.date), ids);
    });
    await t.test('rounds outside declared count or belonging to absent header are denied', async () => {
      const round = Object.values(encodeRounds(session))[0];
      await assertFails(setDoc(doc(db, base + '/sessions/2026-12-01/rounds/1'), round));
      await assertFails(setDoc(doc(db, base + '/sessions/' + session.date + '/rounds/5'), { round: 5, matchMap: { 'r5-c1': { ...session.matchMap['r1-c1'], round: 5 } } }));
    });
    const resultRef = doc(db, base + '/matchResults/2026-10-07_r1-c1');
    await t.test('guest identity is stored with a meeting, excluded from fixed members and strictly validated', async () => {
      const participants = [...ids.slice(0, 3), 'guest001'];
      const generated = generateSchedule(participants, allocateForWindow(participants, 2), { attempts: 10 });
      const guestSession = { ...session, date: '2026-12-06', participantIds: participants, fixedPlayerIds: ids.slice(0, 3), guests: { guest001: { name: '홍길동' } }, lockedPairs: [], endTime: '20:00', matchMap: generated.matchMap, partnerRepeats: generated.partnerRepeats };
      await assertSucceeds(save(guestSession));
      const restored = await load(guestSession.date);
      assert.deepEqual(restored.guests, guestSession.guests);
      validateSession(restored, ids);
      await assertSucceeds(setDoc(doc(db, base + '/matchResults/2026-12-06_r1-c1'), { date: '2026-12-06', matchId: 'r1-c1', scoreA: 6, scoreB: 4, outcome: 'teamA', revision: 1, updatedAt: serverTimestamp() }));
      const badDate = '2026-12-13';
      for (const guests of [{}, { guest001: { name: '' } }, { guest001: { name: ' ' } }, { guest001: { name: '가'.repeat(13) } }, { guest001: { name: '홍길동', rating: 1 } }, { gdr001: { name: '김민종' } }, { guest009: { name: '홍길동' } }]) await assertFails(save({ ...guestSession, date: badDate, guests }));
      await assertFails(save({ ...guestSession, date: badDate, fixedPlayerIds: participants }));
      assert.equal((await getDoc(doc(db, base + '/sessions/' + badDate))).exists(), false);
      const profiles = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`guest00${i + 1}`, { name: `게스트${i + 1}` }]));
      const all = [...ids, ...Object.keys(profiles)], full = generateSchedule(all, allocateForWindow(all, 6), { attempts: 20 });
      await assertSucceeds(save({ ...session, date: '2026-12-20', participantIds: all, fixedPlayerIds: ids, guests: profiles, lockedPairs: [], endTime: '22:00', matchMap: full.matchMap, partnerRepeats: full.partnerRepeats }));
    });
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
      await assertFails(setDoc(doc(db, base + '/matchResults/2026-10-07_r8-c1'), { ...result, matchId: 'r8-c1' }));
      await assertFails(setDoc(doc(db, 'users/somebody'), { name: 'somebody' }));
    });
    await t.test('existing version-one schedules remain readable and scores stay editable', async () => {
      const legacy = { ...session, date: '2026-10-04', lockedPairs: encodeSession(session).lockedPairs };
      await env.withSecurityRulesDisabled(async context => { await setDoc(doc(context.firestore(), base + '/sessions/' + legacy.date), legacy); });
      const restored = decodeSession((await getDoc(doc(db, base + '/sessions/' + legacy.date))).data());
      validateSession(restored, ids);
      await assertSucceeds(setDoc(doc(db, base + '/matchResults/' + legacy.date + '_r1-c1'), { ...result, date: legacy.date }));
    });
  } finally { await env.cleanup(); }
});
