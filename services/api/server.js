import mongoose from 'mongoose';
import { readConfig } from './config.js';
import { User, Job } from './models.js';
import { createRag } from './rag.js';
import { createApp } from './app.js';

const config = readConfig();
await mongoose.connect(config.MONGODB_URI, {dbName: config.MONGODB_DB, serverSelectionTimeoutMS: 10000});
await Promise.all([User.init(), Job.init()]);
const app = createApp({config, User, Job, rag: createRag(config), databaseReady: () => mongoose.connection.readyState === 1});
const server = app.listen(config.PORT, '0.0.0.0', () => console.log(`API listening on ${config.PORT}`));
server.requestTimeout = 65000;
server.headersTimeout = 10000;
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  server.close(async () => {await mongoose.disconnect(); process.exit(0);});
  setTimeout(() => process.exit(1), 15000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
