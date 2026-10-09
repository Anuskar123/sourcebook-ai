import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { wslStatusReady } from './wsl-status.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const file = new URL('../.env', import.meta.url);
const checks = [];
function check(name, ok, help = '') {
  checks.push({name, ok, help});
  console.log(`${ok ? 'OK' : 'MISSING'}: ${name}${!ok && help ? `; ${help}` : ''}`);
}
const nodeParts = process.versions.node.split('.').map(Number);
check('Node 22.12+', nodeParts[0] > 22 || (nodeParts[0] === 22 && nodeParts[1] >= 12));
check('Local environment file', existsSync(file), 'run npm run setup');
if (existsSync(file)) {
  const env = parseEnv(readFileSync(file, 'utf8'));
  for (const key of ['MONGO_PASSWORD', 'NEO4J_PASSWORD', 'JWT_SECRET', 'INTERNAL_API_TOKEN', 'ML_API_TOKEN']) {
    check(key, Boolean(env[key]?.length >= 32 && !env[key].startsWith('replace-')), 'generate an independent secret');
  }
  check('Gemini key configured', Boolean(env.GEMINI_API_KEY?.trim() && !env.GEMINI_API_KEY.startsWith('replace-')), 'set GEMINI_API_KEY in .env; the value is never printed');
  check('Scrape host allowlist', Boolean(env.SCRAPE_ALLOWED_HOSTS?.trim()));
}
if (process.platform === 'win32') {
  const wsl = spawnSync('wsl.exe', ['--status'], {cwd: root, timeout: 10000, windowsHide: true});
  check('WSL 2 prerequisites', wslStatusReady(wsl), 'check Virtual Machine Platform and firmware virtualization (or nested virtualization on a VM); Windows may require a restart');
}
const cli = spawnSync('docker', ['--version'], {cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true});
check('Docker CLI', cli.status === 0, 'install Docker Desktop with its WSL 2 backend');
if (cli.status === 0) {
  const engine = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {cwd: root, encoding: 'utf8', timeout: 15000, windowsHide: true});
  check('Docker engine', engine.status === 0, 'complete WSL 2 setup, then start Docker Desktop');
  const compose = spawnSync('docker', ['compose', 'version'], {cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true});
  check('Docker Compose', compose.status === 0);
  if (compose.status === 0 && existsSync(file)) {
    const config = spawnSync('docker', ['compose', '--profile', 'app', 'config', '--quiet'], {cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true});
    check('Compose configuration', config.status === 0, 'review required settings in .env');
  }
}
process.exitCode = checks.every(item => item.ok) ? 0 : 1;
