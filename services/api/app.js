import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

export function createApp({config, User, Job, Conversation, rag, databaseReady}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet(), cors({origin: config.WEB_ORIGIN}), express.json({limit: '128kb'}));
  app.get('/health/live', (_req, res) => res.json({status: 'ok'}));
  app.get(['/health/ready', '/api/health'], async (_req, res) => {
    try { if (!databaseReady()) throw new Error(); await rag.ready(); res.json({status: 'ready'}); }
    catch { res.status(503).json({status: 'not_ready'}); }
  });
  const authLimit = rateLimit({windowMs: 15 * 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false});
  const credentials = z.object({email: z.email().max(254).transform(v => v.toLowerCase()), password: z.string().min(12).max(72).refine(v => Buffer.byteLength(v, 'utf8') <= 72)}).strict();
  const tokenFor = user => jwt.sign({}, config.JWT_SECRET, {subject: String(user._id), issuer: 'portfolio-api', audience: 'portfolio-web', expiresIn: '15m', algorithm: 'HS256'});
  app.post('/api/auth/register', authLimit, async (req, res) => {
    const {email, password} = credentials.parse(req.body);
    const user = await User.create({email, passwordHash: await bcrypt.hash(password, 12)});
    res.status(201).json({token: tokenFor(user)});
  });
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const {email, password} = credentials.parse(req.body);
    const user = await User.findOne({email}).select('+passwordHash');
    if (!user || !await bcrypt.compare(password, user.passwordHash)) return res.status(401).json({error: 'Invalid credentials'});
    res.json({token: tokenFor(user)});
  });
  function auth(req, res, next) {
    try {
      const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
      const payload = jwt.verify(token, config.JWT_SECRET, {algorithms: ['HS256'], issuer: 'portfolio-api', audience: 'portfolio-web'});
      req.owner = z.string().regex(/^[a-f0-9]{24}$/).parse(payload.sub);
      next();
    } catch { res.status(401).json({error: 'Authentication required'}); }
  }
  app.use('/api', auth, rateLimit({windowMs: 60000, limit: 30, keyGenerator: req => req.owner, standardHeaders: 'draft-8', legacyHeaders: false}));
  const allowedHosts = [...new Set(config.SCRAPE_ALLOWED_HOSTS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))];
  app.get('/api/sources/policy', (_req, res) => res.json({protocol: 'https:', allowedHosts}));
  app.get('/api/sources', async (req, res) => {
    const [indexedChunks, jobs] = await Promise.all([
      rag.sourceCount(req.owner),
      Job.find({ownerId: req.owner}).sort({createdAt: -1}).limit(20).select('url status error createdAt').lean(),
    ]);
    res.json({indexedChunks, jobs: jobs.map(job => ({id: String(job._id), url: job.url, status: job.status, error: job.error}))});
  });
  const objectId = z.string().regex(/^[a-f0-9]{24}$/);
  app.get('/api/conversations', async (req, res) => {
    const items = await Conversation.find({ownerId: req.owner}).sort({updatedAt: -1}).limit(50).select('title updatedAt').lean();
    res.json({conversations: items.map(c => ({id: String(c._id), title: c.title, updatedAt: c.updatedAt}))});
  });
  app.post('/api/conversations', async (req, res) => {
    z.object({}).strict().parse(req.body);
    const c = await Conversation.create({ownerId: req.owner});
    res.status(201).json({id: String(c._id), title: c.title, messages: []});
  });
  app.get('/api/conversations/:id', async (req, res) => {
    const c = await Conversation.findOne({_id: objectId.parse(req.params.id), ownerId: req.owner}).select('title messages updatedAt').lean();
    if (!c) return res.status(404).json({error: 'Conversation not found'});
    res.json({id: String(c._id), title: c.title, messages: c.messages, updatedAt: c.updatedAt});
  });
  app.delete('/api/conversations/:id', async (req, res) => {
    const result = await Conversation.deleteOne({_id: objectId.parse(req.params.id), ownerId: req.owner});
    if (!result.deletedCount) return res.status(404).json({error: 'Conversation not found'});
    res.json({deleted: true});
  });
  app.post('/api/chat', async (req, res) => {
    const {message, conversationId} = z.object({message: z.string().trim().min(1).max(4000), conversationId: objectId.optional()}).strict().parse(req.body);
    let conversation;
    if (conversationId) {
      conversation = await Conversation.findOne({_id: conversationId, ownerId: req.owner}).select('messages title').lean();
      if (!conversation) return res.status(404).json({error: 'Conversation not found'});
      if (conversation.messages.length >= 200) return res.status(409).json({error: 'This conversation is full. Start a new conversation.'});
    }
    const result = await rag.answer(req.owner, message);
    if (conversationId) {
      const saved = await Conversation.updateOne({_id: conversationId, ownerId: req.owner, 'messages.198': {$exists: false}}, {
        $push: {messages: {$each: [{role: 'user', text: message, sources: []}, {role: 'assistant', text: result.answer, sources: result.sources}]}},
        ...(conversation.messages.length === 0 ? {$set: {title: message.slice(0, 80)}} : {}),
      });
      if (!saved.matchedCount) return res.status(409).json({error: 'Conversation changed or was removed. Reopen it or start a new conversation.'});
    }
    res.json(result);
  });
  app.post('/api/jobs', async (req, res) => {
    const {url} = z.object({url: z.url().max(2048)}).strict().parse(req.body);
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return res.status(400).json({error: 'Use an HTTPS URL, for example https://example.com.'});
    if (parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) return res.status(400).json({error: 'Use a public HTTPS URL without credentials or a custom port.'});
    if (!allowedHosts.includes(parsed.hostname)) return res.status(400).json({error: `This hostname is not approved. Approved hosts: ${allowedHosts.join(', ')}.`, allowedHosts});
    parsed.hash = '';
    const job = await Job.create({ownerId: req.owner, url: parsed.href});
    res.status(202).json({id: String(job._id), status: job.status});
  });
  app.get('/api/jobs/:id', async (req, res) => {
    const id = z.string().regex(/^[a-f0-9]{24}$/).parse(req.params.id);
    const job = await Job.findOne({_id: id, ownerId: req.owner}).select('status result error createdAt updatedAt').lean();
    if (!job) return res.status(404).json({error: 'Job not found'});
    res.json(job);
  });
  // Example authenticated Node -> FastAPI request; the worker uses the same contract.
  app.post('/api/classify', async (req, res) => {
    const input = z.object({text: z.string().trim().min(1).max(20000)}).strict().parse(req.body);
    const response = await fetch(`${config.ML_API_URL}/predict`, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Service-Token': config.ML_API_TOKEN}, body: JSON.stringify(input), signal: AbortSignal.timeout(10000)});
    if (!response.ok) return res.status(502).json({error: 'Classifier unavailable'});
    res.json(await response.json());
  });
  app.post('/internal/jobs/:id/index', async (req, res) => {
    const provided = Buffer.from(req.get('X-Service-Token') || '');
    const expected = Buffer.from(config.INTERNAL_API_TOKEN);
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return res.status(401).json({error: 'Invalid service credential'});
    const id = z.string().regex(/^[a-f0-9]{24}$/).parse(req.params.id);
    const {text, leaseToken} = z.object({text: z.string().min(1).max(60000), leaseToken: z.string().uuid()}).strict().parse(req.body);
    const job = await Job.findOne({_id: id, status: 'running', leaseToken, leaseUntil: {$gt: new Date()}}).lean();
    if (!job) return res.status(409).json({error: 'Job lease expired'});
    res.json({chunks: await rag.ingest(job.ownerId, id, text, job.url)});
  });
  app.use((_req, res) => res.status(404).json({error: 'Not found'}));
  app.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) return res.status(400).json({error: 'Invalid request', issues: error.issues.map(i => ({path: i.path, message: i.message}))});
    if (error.code === 11000) return res.status(409).json({error: 'Account already exists'});
    if (error.type === 'entity.parse.failed') return res.status(400).json({error: 'Invalid JSON'});
    if (error.type === 'entity.too.large') return res.status(413).json({error: 'Request too large'});
    console.error(JSON.stringify({event: 'request_failed', type: error.name}));
    res.status(500).json({error: 'Request failed'});
  });
  return app;
}
