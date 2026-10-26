import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ProjectStore } from './store.js';
import { ID, validateProject } from './project.js';
import { parseSuggestRequest, suggestChords } from './harmony.js';
import { reviewSketch } from './review.js';

const http = (status, message) => Object.assign(new Error(message), { status });

export async function createApp({ dataDir, token = '', origins = ['http://127.0.0.1:5173', 'http://localhost:5173'], maxBytes = 30 * 1024 * 1024 }) {
  const store = new ProjectStore(dataDir);
  await store.init();
  async function readJson(req, limit) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw http(415, 'Use application/json.');
    if (Number(req.headers['content-length']) > limit) throw http(413, 'Request exceeds the upload limit.');
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw http(413, 'Request exceeds the upload limit.');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw http(400, 'Invalid JSON.'); }
  }
  return createServer(async (req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(body === undefined ? undefined : JSON.stringify(body));
    };
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin)) return send(403, { error: 'Origin not allowed.' });
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return send(204);
    if (token) {
      const actual = Buffer.from(req.headers.authorization || '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return send(401, { error: 'Authentication required.' });
    }
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/api/health' && req.method === 'GET') return send(200, { status: 'ok', version: 1 });
      if (path === '/api/projects' && req.method === 'GET') return send(200, { projects: await store.list() });
      if (path === '/api/harmony/suggest' || path === '/api/harmony/review') {
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(405, { error: 'Method not allowed.' }); }
        // Suggestion requests carry notes and chords only, never recordings, so a small limit suffices.
        const request = parseSuggestRequest(await readJson(req, Math.min(maxBytes, 1024 * 1024)));
        return send(200, path.endsWith('/review') ? reviewSketch(request) : suggestChords(request));
      }
      const match = path.match(/^\/api\/projects\/([^/]+)$/);
      if (!match) return send(404, { error: 'Route not found.' });
      const id = match[1];
      if (!ID.test(id)) return send(400, { error: 'Invalid project ID.' });
      if (req.method === 'GET') return send(200, await store.get(id));
      if (req.method === 'DELETE') { await store.delete(id); return send(204); }
      if (req.method !== 'PUT') { res.setHeader('Allow', 'GET, PUT, DELETE'); return send(405, { error: 'Method not allowed.' }); }
      const project = await readJson(req, maxBytes);
      if (project?.id !== id) return send(400, { error: 'Project ID does not match URL.' });
      const saved = await store.put(validateProject(project));
      return send(200, { id: saved.id, updatedAt: saved.updatedAt });
    } catch (error) {
      if (!error.status) console.error('Project request failed:', error.message);
      if (!res.headersSent) send(error.status || 500, { error: error.status ? error.message : 'Internal server error.' });
    }
  });
}
