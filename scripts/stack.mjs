import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const action = process.argv[2] || 'up';
const actions = {
  up: ['--profile', 'app', 'up', '--build', '-d', '--wait', '--wait-timeout', '180'],
  down: ['--profile', 'app', 'down'],
  status: ['--profile', 'app', 'ps'],
  logs: ['--profile', 'app', 'logs', '--tail', '100'],
};
if (!actions[action]) throw new Error('Unknown stack action');
if (action === 'up') {
  const result = spawnSync(process.execPath, ['scripts/doctor.mjs'], {cwd: root, stdio: 'inherit', windowsHide: true});
  if (result.status !== 0) process.exit(result.status || 1);
}
const result = spawnSync('docker', ['compose', ...actions[action]], {cwd: root, stdio: 'inherit', windowsHide: true});
if (result.error) console.error('Docker could not start. Run npm run doctor for setup details.');
process.exitCode = result.status ?? 1;
