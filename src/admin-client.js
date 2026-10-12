export async function createAdminClient() {
  const [{ getApps, getApp, initializeApp }, authSdk, functionsSdk] = await Promise.all([import('firebase/app'), import('firebase/auth'), import('firebase/functions')]);
  const app = getApps().length ? getApp() : initializeApp({ apiKey: import.meta.env.VITE_FIREBASE_API_KEY, authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID, appId: import.meta.env.VITE_FIREBASE_APP_ID });
  const auth = authSdk.getAuth(app);
  await authSdk.setPersistence(auth, authSdk.browserSessionPersistence);
  const functions = functionsSdk.getFunctions(app, 'asia-northeast3');
  const call = async (name, data) => (await functionsSdk.httpsCallable(functions, name, { timeout: 85000 })(data)).data;
  return {
    observe: callback => authSdk.onAuthStateChanged(auth, callback),
    login: (email, password) => authSdk.signInWithEmailAndPassword(auth, email, password),
    logout: () => authSdk.signOut(auth),
    state: agentId => call('adminChatState', { agentId }),
    send: data => call('adminChat', data),
  };
}
