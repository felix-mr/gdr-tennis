export async function readHistory(onChange, onStatus) {
  const configured = ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'APP_ID'].every(key => import.meta.env[`VITE_FIREBASE_${key}`]);
  if (!configured) { onChange([]); onStatus('이전 기록은 공유 DB에서 불러옵니다.'); return; }
  const [{ getApp }, fs] = await Promise.all([import('firebase/app'), import('firebase/firestore')]);
  return fs.onSnapshot(fs.collection(fs.getFirestore(getApp()), 'clubs/gdr/historySets'), { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
    onChange(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })));
    onStatus('이전 기록 불러옴');
  }, error => onStatus(error.code === 'permission-denied' ? '이전 기록 조회 권한 반영을 기다리고 있습니다.' : '이전 기록을 불러오지 못했습니다. 새로고침해 주세요.'));
}
