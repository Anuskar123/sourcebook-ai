import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const env = {...parseEnv(readFileSync(new URL('../.env', import.meta.url), 'utf8')), ...process.env};
const base = env.API_URL || 'http://127.0.0.1:3000';
let token;
async function call(path, body, expected = 200, authenticated = true) {
  const response = await fetch(`${base}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {'Content-Type': 'application/json', ...(authenticated && token ? {Authorization: `Bearer ${token}`} : {})},
    ...(body ? {body: JSON.stringify(body)} : {}),
    signal: AbortSignal.timeout(65000),
  });
  assert.equal(response.status, expected, `${path} returned HTTP ${response.status}, expected ${expected}`);
  return response.json();
}

try {
  await call('/health/ready', undefined, 200, false);
  await call('/api/chat', {message: 'unauthenticated probe'}, 401, false);
  const suffix = randomBytes(8).toString('hex');
  const account = await call('/api/auth/register', {email: `smoke-${suffix}@example.invalid`, password: randomBytes(24).toString('hex')}, 201, false);
  token = account.token;
  assert.ok(token);
  console.log('API readiness, authentication and registration passed.');

  const prediction = await call('/api/classify', {text: 'Python software API programming cloud application'});
  assert.equal(typeof prediction.label, 'string');
  assert.ok(prediction.confidence >= 0 && prediction.confidence <= 1);
  console.log('Authenticated Node -> FastAPI classification passed.');

  const url = env.SMOKE_SOURCE_URL || 'https://example.com';
  const job = await call('/api/jobs', {url}, 202);
  let status;
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    status = await call(`/api/jobs/${job.id}`);
    if (status.status === 'completed' || status.status === 'failed') break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert.equal(status?.status, 'completed', `Agent job did not complete: ${status?.status}`);
  assert.ok(status.result?.prediction?.model_version);
  console.log('Scraping, structured extraction, classification, graph persistence and indexing completed.');

  const answer = await call('/api/chat', {message: 'What is this website about? Answer only from the indexed source.'});
  assert.equal(typeof answer.answer, 'string');
  assert.ok(answer.answer.length > 0);
  assert.ok(answer.sources?.length > 0);
  console.log('Gemini RAG returned an answer with retrieved sources.');
  console.log('Full-stack smoke test passed. A disposable test account and source snapshot remain in the local databases.');
} catch (error) {
  console.error(`Smoke test failed: ${error.message}`);
  process.exitCode = 1;
}
