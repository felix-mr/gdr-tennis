import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const settings = loadEnv('production', root);
for (const key of ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'APP_ID']) if (!settings[`VITE_FIREBASE_${key}`]) throw new Error(`Missing Firebase setting: ${key}`);
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, stdio: 'inherit' });
const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim();
const branch = spawnSync('git', ['ls-remote', '--exit-code', remote, 'refs/heads/gh-pages'], { cwd: root, encoding: 'utf8' });
if (![0, 2].includes(branch.status)) throw new Error('GitHub access failed. Check Git authentication.');

// Build with the local Firebase configuration. Never publish .env or source files.
run('npm', ['run', 'build']);
const checkout = mkdtempSync(join(tmpdir(), 'gdr-pages-'));
try {
  run('git', ['init', '--initial-branch=gh-pages'], checkout);
  if (branch.status === 0) {
    run('git', ['fetch', '--depth=1', remote, 'gh-pages'], checkout);
    run('git', ['reset', '--hard', 'FETCH_HEAD'], checkout);
  }
  for (const name of readdirSync(checkout)) if (name !== '.git') rmSync(join(checkout, name), { recursive: true, force: true });
  cpSync(join(root, 'dist'), checkout, { recursive: true });
  writeFileSync(join(checkout, '.nojekyll'), '');
  run('git', ['add', '--all'], checkout);
  const changes = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: checkout });
  if (changes.status === 0) console.log('Published build already matches local build.');
  else {
    if (changes.status !== 1) throw new Error('Cannot inspect built files.');
    run('git', ['commit', '-m', 'Deploy GDR website'], checkout);
    run('git', ['push', remote, 'HEAD:refs/heads/gh-pages'], checkout);
  }
} finally {
  rmSync(checkout, { recursive: true, force: true });
}
