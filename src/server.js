import { resolve } from 'node:path';
import { createApp } from './app.js';

const host = process.env.HOST || '127.0.0.1';
const token = process.env.API_TOKEN || '';
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && token.length < 32) {
  throw new Error('Non-loopback hosting requires an API_TOKEN of at least 32 characters.');
}
const server = await createApp({
  dataDir: resolve(process.env.DATA_DIR || './data'), token,
  origins: (process.env.ALLOWED_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173').split(',').map(x => x.trim()).filter(Boolean),
});
server.requestTimeout = 30_000;
server.listen(Number(process.env.PORT || 3001), host, () => console.log(`Mumak API: http://${host}:${server.address().port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
