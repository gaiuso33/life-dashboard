// Builds the two copies of the app the tests run against: the normal build, and one wired to the local mock Supabase.
import { execSync } from 'child_process';
const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
run('npx vite build --outDir dist-e2e --emptyOutDir');
run('npx vite build --outDir dist-e2e-cloud --emptyOutDir', {
  VITE_SUPABASE_URL: 'http://localhost:4600',
  VITE_SUPABASE_ANON_KEY: 'test-anon',
  VITE_SYNC_MIN_GAP_MS: '300',
});
