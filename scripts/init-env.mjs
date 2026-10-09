import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(target)) {
  console.log('.env already exists; existing credentials were preserved.');
} else {
  let content = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const secrets = Object.fromEntries(['MONGO_PASSWORD', 'NEO4J_PASSWORD', 'JWT_SECRET', 'INTERNAL_API_TOKEN', 'ML_API_TOKEN'].map(key => [key, randomBytes(32).toString('hex')]));
  for (const [key, value] of Object.entries(secrets)) {
    content = content.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`);
  }
  content = content.replace('mongodb://root:replace-with-random-hex@', `mongodb://root:${secrets.MONGO_PASSWORD}@`);
  writeFileSync(target, content, {flag: 'wx', mode: 0o600});
  console.log('Created .env with five independent random secrets. Add GEMINI_API_KEY locally.');
}
