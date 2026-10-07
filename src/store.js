import { validResult, validateSession } from './model.js';
import players from '../data/players.json';
import { encodeSession, encodeRounds, decodeSession } from './session-codec.js';
import { generationOf, requireCancellation, discardSession } from './session-lifecycle.js';
const KEY = 'gdr-tennis-v1';
const blank = () => ({ schemaVersion: 1, sessions: {}, results: {} });
const clone = value => structuredClone(value);
function parse(raw) {
  const state = raw ? JSON.parse(raw) : blank();
  if (state.schemaVersion !== 1 || !state.sessions || !state.results) throw new Error('저장 형식을 확인해 주세요.');
  for (const [date, s] of Object.entries(state.sessions)) { validateSession(s, players.map(p => p.id)); if (date !== s.date) throw new Error('날짜가 일치하지 않습니다.'); }
  for (const [key, r] of Object.entries(state.results)) {
    const date = key.slice(0, 10), matchId = key.slice(11);
    if (!state.sessions[date]?.matchMap[matchId] || !validResult(r) || !Number.isInteger(r.revision) || r.revision < 1) throw new Error('경기 결과 형식을 확인해 주세요.');
  }
  return state;
}
export const firebaseConfigured = ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'APP_ID'].every(key => import.meta.env[`VITE_FIREBASE_${key}`]);
export async function createStore(onChange, onStatus) {
  let state = blank(), canWrite = !firebaseConfigured;
  const notify = () => onChange(clone(state));
  const report = text => onStatus(text, canWrite);
  if (!firebaseConfigured) {
    try { state = parse(localStorage.getItem(KEY)); } catch (error) { throw new Error(`로컬 기록을 읽을 수 없습니다. ${error.message} 기존 저장 내용은 유지됩니다.`); }
    const locked = fn => navigator.locks ? navigator.locks.request(KEY, fn) : fn();
    const mutate = async fn => locked(() => {
      const next = parse(localStorage.getItem(KEY)); fn(next);
      localStorage.setItem(KEY, JSON.stringify(next)); state = next; notify();
    });
    window.addEventListener('storage', event => { if (event.key === KEY) { try { state = parse(event.newValue); notify(); } catch { report('다른 창의 저장 기록을 확인해 주세요.'); } } });
    notify(); report('이 기기에 저장 · 다른 기기와 공유되지 않음');
    return {
      get canWrite() { return true; },
      async saveSession(s) { validateSession(s, players.map(p => p.id)); await mutate(next => { if (next.sessions[s.date]) throw new Error('이미 저장된 날짜입니다. 기존 대진표를 확인해 주세요.'); next.sessions[s.date] = { ...clone(s), generation: crypto.randomUUID().replaceAll('-', '') }; }); },
      async cancelSession(date, generation, text) { await mutate(next => discardSession(next, date, generation, text)); },
      async saveResult(date, id, r, revision, generation) { await mutate(next => {
        const key = `${date}_${id}`;
        if (!next.sessions[date]?.matchMap[id] || !validResult(r)) throw new Error('경기 점수를 확인해 주세요.');
        if (generationOf(next.sessions[date]) !== generation) throw new Error('대진이 변경됐습니다. 최신 대진을 확인해 주세요.');
        if ((next.results[key]?.revision || 0) !== revision) throw new Error('다른 창에서 점수가 변경됐습니다. 최신 점수를 확인한 후 다시 저장해 주세요.');
        next.results[key] = { ...r, ...(generation === 'legacy' ? {} : { generation }), revision: revision + 1, updatedAt: new Date().toISOString() };
      }); },
      async importBackup(raw) { const imported = parse(raw); await mutate(next => {
        for (const date of Object.keys(imported.sessions)) if (next.sessions[date]) throw new Error(`${date} 기록이 이미 있습니다. 가져오기로 덮어쓸 수 없습니다.`);
        Object.assign(next.sessions, imported.sessions); Object.assign(next.results, imported.results);
      }); },
      async login() {},
    };
  }
  const [{ initializeApp }, fs] = await Promise.all([import('firebase/app'), import('firebase/firestore')]);
  const app = initializeApp({ apiKey: import.meta.env.VITE_FIREBASE_API_KEY, authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID, appId: import.meta.env.VITE_FIREBASE_APP_ID });
  const db = fs.getFirestore(app);
  canWrite = true;
  const base = 'clubs/gdr';
  const sessionCache = new Map();
  let sessionSnapshotVersion = 0;
  let sessionReady = false, resultReady = false;
  const ready = () => { if (sessionReady && resultReady) { notify(); report(canWrite ? '공유 기록 연결됨 · 로그인 없이 입력' : '공유 기록 연결됨 · 조회 가능'); } };
  for (const type of ['sessions', 'matchResults']) {
    fs.onSnapshot(fs.collection(db, `${base}/${type}`), { includeMetadataChanges: true }, async snapshot => {
      if (snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache) return;
      let entries;
      if (type === 'sessions') {
        const version = ++sessionSnapshotVersion;
        try {
          entries = Object.fromEntries(await Promise.all(snapshot.docs.map(async doc => {
            const header = doc.data();
            const signature = JSON.stringify(header);
            if (sessionCache.get(doc.id)?.signature === signature) return [doc.id, sessionCache.get(doc.id).session];
            const roundDocuments = header.schemaVersion === 2 ? (await fs.getDocsFromServer(fs.collection(db, `${base}/sessions/${doc.id}/rounds`))).docs.map(round => round.data()) : [];
            const session = decodeSession(header, roundDocuments);
            validateSession(session, players.map(p => p.id));
            if (doc.id !== session.date) throw new Error('날짜 불일치');
            sessionCache.set(doc.id, { signature, session });
            return [doc.id, session];
          })));
        } catch (error) { if (version !== sessionSnapshotVersion) return; canWrite = false; report(error.code === 'permission-denied' ? '공유 기록 접근 권한을 확인해 주세요.' : '공유 대진표 형식을 확인해 주세요. 기존 기록은 유지됩니다.'); return; }
        if (version !== sessionSnapshotVersion) return;
        for (const key of sessionCache.keys()) if (!Object.hasOwn(entries, key)) sessionCache.delete(key);
        state.sessions = entries; sessionReady = true;
      } else { state.results = Object.fromEntries(snapshot.docs.map(doc => [doc.id, doc.data()])); resultReady = true; }
      ready();
    }, error => { canWrite = false; report(error.code === 'permission-denied' ? '공유 기록 접근 권한을 확인해 주세요.' : '공유 기록 연결 실패 · 새로고침해 다시 연결'); });
  }
  const requireWrite = () => { if (!canWrite || !navigator.onLine || !sessionReady || !resultReady) throw new Error('공유 기록 연결 상태를 확인해 주세요.'); };
  return {
    get canWrite() { return canWrite && navigator.onLine && sessionReady && resultReady; },
    async saveSession(s) { requireWrite(); validateSession(s, players.map(p => p.id)); const generation = crypto.randomUUID().replaceAll('-', ''); await fs.runTransaction(db, async tx => {
      const ref = fs.doc(db, `${base}/sessions/${s.date}`);
      if ((await tx.get(ref)).exists()) throw new Error('이미 저장된 날짜입니다.');
      tx.set(ref, { ...encodeSession(s), generation, createdAt: fs.serverTimestamp() });
      for (const [round, data] of Object.entries(encodeRounds(s))) tx.set(fs.doc(db, `${base}/sessions/${s.date}/rounds/${round}`), data);
    }); },
    async cancelSession(date, generation, text) {
      requireWrite();
      await fs.runTransaction(db, async tx => {
        const ref = fs.doc(db, `${base}/sessions/${date}`), header = await tx.get(ref);
        const session = header.exists() ? header.data() : null;
        requireCancellation(session, generation, text);
        const roundRefs = session.schemaVersion === 2 ? Array.from({ length: session.roundCount }, (_, i) => fs.doc(db, `${base}/sessions/${date}/rounds/${i + 1}`)) : [];
        const rounds = await Promise.all(roundRefs.map(ref => tx.get(ref)));
        if (rounds.some(round => !round.exists())) throw new Error('저장된 대진을 확인해 주세요. 삭제하지 않았습니다.');
        const restored = decodeSession(session, rounds.map(round => round.data()));
        validateSession(restored, players.map(player => player.id));
        const matches = Object.keys(restored.matchMap);
        const resultRefs = matches.map(id => fs.doc(db, `${base}/matchResults/${date}_${id}`));
        const results = await Promise.all(resultRefs.map(ref => tx.get(ref)));
        // Receipt contains no teams or scores. It blocks stale clients and generation reuse.
        tx.set(fs.doc(db, `${base}/sessionCancellations/${date}--${generation}`), { date, generation, confirmation: text, cancelledAt: fs.serverTimestamp() });
        for (const result of results) if (result.exists()) tx.delete(result.ref);
        for (const round of rounds) if (round.exists()) tx.delete(round.ref);
        tx.delete(ref);
      });
    },
    async saveResult(date, id, r, revision, generation) { requireWrite(); if (!validResult(r)) throw new Error('점수를 확인해 주세요.'); await fs.runTransaction(db, async tx => {
      const session = await tx.get(fs.doc(db, `${base}/sessions/${date}`));
      if (!session.exists() || generationOf(session.data()) !== generation) throw new Error('대진이 변경되었거나 취소됐습니다. 최신 대진을 확인해 주세요.');
      const ref = fs.doc(db, `${base}/matchResults/${date}_${id}`);
      const existing = await tx.get(ref);
      if ((existing.data()?.revision || 0) !== revision) throw new Error('다른 사람이 점수를 변경했습니다. 최신 기록 확인 후 다시 저장해 주세요.');
      tx.set(ref, { date, matchId: id, ...r, ...(generation === 'legacy' ? {} : { generation }), revision: revision + 1, updatedAt: fs.serverTimestamp() });
    }); },
    async login() {},
    async importBackup() { throw new Error('공유 기록 가져오기는 중복 여부 확인 후 별도로 진행합니다.'); },
  };
}
