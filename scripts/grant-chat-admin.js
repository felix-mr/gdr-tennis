import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
const option = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const uid = option('--uid'), projectId = option('--project');
if (!uid || !projectId) throw new Error('Use --project PROJECT_ID --uid FIREBASE_AUTH_UID.');
initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth(), user = await auth.getUser(uid);
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ exists: true, admin: user.customClaims?.gdrAdmin === true, disabled: user.disabled, action: 'Add gdrAdmin claim; account and existing claims are preserved. Use --apply to proceed.' }));
} else {
  if (user.disabled) throw new Error('Enable the account before granting administrator access.');
  await auth.setCustomUserClaims(uid, { ...user.customClaims, gdrAdmin: true });
  if (option('--display-name')) await auth.updateUser(uid, { displayName: option('--display-name') });
  const updated = await auth.getUser(uid);
  if (updated.customClaims?.gdrAdmin !== true) throw new Error('Could not verify administrator access.');
  console.log('Administrator access verified. Sign out and sign in again to refresh the session.');
}
