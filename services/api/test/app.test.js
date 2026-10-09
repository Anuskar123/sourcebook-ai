import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../app.js';

const owner = 'a'.repeat(24);
const config = {JWT_SECRET: 's'.repeat(40), INTERNAL_API_TOKEN: 'i'.repeat(40), WEB_ORIGIN: 'http://localhost:5173', SCRAPE_ALLOWED_HOSTS: 'example.com'};
const token = jwt.sign({}, config.JWT_SECRET, {subject: owner, issuer: 'portfolio-api', audience: 'portfolio-web', expiresIn: '1m'});
const make = (overrides = {}) => createApp({config, User: {}, Job: {}, rag: {}, databaseReady: () => true, ...overrides});

test('chat rejects missing and wrongly scoped JWTs', async () => {
  await request(make()).post('/api/chat').send({message: 'hello'}).expect(401);
  const wrong = jwt.sign({}, config.JWT_SECRET, {subject: owner, issuer: 'other', audience: 'portfolio-web'});
  await request(make()).post('/api/chat').auth(wrong, {type: 'bearer'}).send({message: 'hello'}).expect(401);
});
test('chat derives tenant from JWT and rejects owner injection', async () => {
  let received;
  const app = make({rag: {answer: async (...args) => {received = args; return {answer: 'ok', sources: []};}}});
  await request(app).post('/api/chat').auth(token, {type: 'bearer'}).send({message: 'hello', ownerId: 'victim'}).expect(400);
  await request(app).post('/api/chat').auth(token, {type: 'bearer'}).send({message: 'hello'}).expect(200);
  assert.deepEqual(received, [owner, 'hello']);
});
test('job creation rejects unapproved URLs and sets authenticated owner', async () => {
  let created;
  const app = make({Job: {create: async value => {created = value; return {_id: owner, status: 'queued'};}}});
  for (const url of ['https://localhost/', 'http://example.com', 'https://example.com.evil.test', 'https://u:p@example.com']) {
    await request(app).post('/api/jobs').auth(token, {type: 'bearer'}).send({url}).expect(400);
  }
  await request(app).post('/api/jobs').auth(token, {type: 'bearer'}).send({url: 'https://example.com'}).expect(202);
  assert.equal(created.ownerId, owner);
});
test('job lookup includes ownership filter', async () => {
  let query;
  const app = make({Job: {findOne: q => {query = q; return {select: () => ({lean: async () => null})};}}});
  await request(app).get(`/api/jobs/${'b'.repeat(24)}`).auth(token, {type: 'bearer'}).expect(404);
  assert.equal(query.ownerId, owner);
});
test('source policy requires authentication and URL errors identify the restriction', async () => {
  const app = make();
  await request(app).get('/api/sources/policy').expect(401);
  const policy = await request(app).get('/api/sources/policy').auth(token, {type: 'bearer'}).expect(200);
  assert.deepEqual(policy.body, {protocol: 'https:', allowedHosts: ['example.com']});
  const hostError = await request(app).post('/api/jobs').auth(token, {type: 'bearer'}).send({url: 'https://other.example'}).expect(400);
  assert.match(hostError.body.error, /Approved hosts: example.com/);
  const protocolError = await request(app).post('/api/jobs').auth(token, {type: 'bearer'}).send({url: 'http://example.com'}).expect(400);
  assert.match(protocolError.body.error, /HTTPS URL/);
});
test('source readiness and restored jobs are scoped to the signed-in account', async () => {
  let receivedOwner, receivedQuery;
  const app = make({rag: {sourceCount: async principal => {receivedOwner = principal; return 10;}}, Job: {
    find: query => {receivedQuery = query; return {sort: () => ({limit: () => ({select: () => ({lean: async () => [
      {_id: 'b'.repeat(24), url: 'https://example.com/', status: 'completed', checkpoint: {text: 'private'}, leaseToken: 'private'},
    ]})})})};},
  }});
  await request(app).get('/api/sources').expect(401);
  const result = await request(app).get('/api/sources?ownerId=victim').auth(token, {type: 'bearer'}).expect(200);
  assert.equal(receivedOwner, owner);
  assert.deepEqual(receivedQuery, {ownerId: owner});
  assert.deepEqual(result.body, {indexedChunks: 10, jobs: [{id: 'b'.repeat(24), url: 'https://example.com/', status: 'completed'}]});
});
test('index callback rejects absent credential and expired lease', async () => {
  const app = make({Job: {findOne: () => ({lean: async () => null})}});
  await request(app).post(`/internal/jobs/${owner}/index`).send({}).expect(401);
  await request(app).post(`/internal/jobs/${owner}/index`).set('X-Service-Token', config.INTERNAL_API_TOKEN).send({text: 'source', leaseToken: '00000000-0000-4000-8000-000000000000'}).expect(409);
});
test('invalid JSON and readiness failure have explicit statuses', async () => {
  await request(make()).post('/api/auth/login').set('Content-Type', 'application/json').send('{').expect(400);
  await request(make({databaseReady: () => false})).get('/health/ready').expect(503);
  await request(make({rag: {ready: async () => {}}})).get('/api/health').expect(200);
});
