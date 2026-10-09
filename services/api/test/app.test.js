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

function conversationStore() {
  const records = new Map();
  const id = 'c'.repeat(24);
  return {
    records,
    create: async data => {const record = {_id: id, title: 'New conversation', messages: [], ...data}; records.set(id, record); return record;},
    find: query => ({sort: () => ({limit: () => ({select: () => ({lean: async () => [...records.values()].filter(c => c.ownerId === query.ownerId)})})})}),
    findOne: query => ({select: () => ({lean: async () => {const record = records.get(query._id); return record?.ownerId === query.ownerId ? structuredClone(record) : null;}})}),
    deleteOne: async query => {const record = records.get(query._id); if (record?.ownerId !== query.ownerId) return {deletedCount: 0}; records.delete(query._id); return {deletedCount: 1};},
    updateOne: async (query, update) => {const record = records.get(query._id); if (record?.ownerId !== query.ownerId || record.messages.length >= 199) return {matchedCount: 0}; record.messages.push(...update.$push.messages.$each); Object.assign(record, update.$set); return {matchedCount: 1};},
  };
}
test('saved conversations require authentication and cannot expose another account', async () => {
  const store = conversationStore();
  const app = make({Conversation: store});
  await request(app).get('/api/conversations').expect(401);
  await request(app).post('/api/conversations').auth(token, {type: 'bearer'}).send({ownerId: 'victim'}).expect(400);
  const created = await request(app).post('/api/conversations').auth(token, {type: 'bearer'}).send({}).expect(201);
  const other = jwt.sign({}, config.JWT_SECRET, {subject: 'd'.repeat(24), issuer: 'portfolio-api', audience: 'portfolio-web'});
  await request(app).get(`/api/conversations/${created.body.id}`).auth(other, {type: 'bearer'}).expect(404);
  await request(app).delete(`/api/conversations/${created.body.id}`).auth(other, {type: 'bearer'}).expect(404);
  const list = await request(app).get('/api/conversations').auth(other, {type: 'bearer'}).expect(200);
  assert.deepEqual(list.body.conversations, []);
});
test('chat transcript can be reopened and removed with source links preserved', async () => {
  const store = conversationStore();
  const app = make({Conversation: store, rag: {answer: async () => ({answer: 'Grounded answer', sources: ['https://example.com/']})}});
  const created = await request(app).post('/api/conversations').auth(token, {type: 'bearer'}).send({}).expect(201);
  const id = created.body.id;
  await request(app).post('/api/chat').auth(token, {type: 'bearer'}).send({message: 'What is this page?', conversationId: id}).expect(200);
  const saved = await request(app).get(`/api/conversations/${id}`).auth(token, {type: 'bearer'}).expect(200);
  assert.equal(saved.body.title, 'What is this page?');
  assert.deepEqual(saved.body.messages, [{role: 'user', text: 'What is this page?', sources: []}, {role: 'assistant', text: 'Grounded answer', sources: ['https://example.com/']}]);
  await request(app).delete(`/api/conversations/${id}`).auth(token, {type: 'bearer'}).expect(200);
  await request(app).get(`/api/conversations/${id}`).auth(token, {type: 'bearer'}).expect(404);
});
test('missing, foreign, and full conversations never trigger model calls', async () => {
  const store = conversationStore();
  let calls = 0;
  const app = make({Conversation: store, rag: {answer: async () => {calls++; return {};}}});
  await request(app).post('/api/chat').auth(token, {type: 'bearer'}).send({message: 'hi', conversationId: 'e'.repeat(24)}).expect(404);
  const c = await store.create({ownerId: 'd'.repeat(24)});
  await request(app).post('/api/chat').auth(token, {type: 'bearer'}).send({message: 'hi', conversationId: c._id}).expect(404);
  c.ownerId = owner; c.messages = Array.from({length: 200}, () => ({role: 'user', text: 'earlier'}));
  await request(app).post('/api/chat').auth(token, {type: 'bearer'}).send({message: 'hi', conversationId: c._id}).expect(409);
  assert.equal(calls, 0);
});
test('a conversation removed during generation cannot be recreated by a late response', async () => {
  const store = conversationStore();
  const c = await store.create({ownerId: owner});
  const app = make({Conversation: store, rag: {answer: async () => {store.records.delete(c._id); return {answer: 'late', sources: []};}}});
  await request(app).post('/api/chat').auth(token, {type: 'bearer'}).send({message: 'hi', conversationId: c._id}).expect(409);
  assert.equal(store.records.size, 0);
});
