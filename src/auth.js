import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
const failure = (status, message) => Object.assign(new Error(message), { status });
const usernamePattern = /^[a-zA-Z0-9_-]{3,64}$/;

export class AuthStore {
  constructor(directory) {
    this.directory = join(directory, 'users');
    this.sessions = new Map();
    this.attempts = new Map();
    this.registration = Promise.resolve();
  }
  async init() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); }
  username(value) {
    if (typeof value !== 'string' || !usernamePattern.test(value)) throw failure(400, 'Username must be 3–64 letters, numbers, underscores or hyphens.');
    return value.toLowerCase();
  }
  async register(body) {
    const username = this.username(body?.username);
    if (typeof body?.password !== 'string' || body.password.length < 12 || body.password.length > 128) throw failure(400, 'Password must be 12–128 characters.');
    // Serialize registration to make duplicate checks atomic within this server.
    const task = this.registration.catch(() => {}).then(async () => {
      const target = join(this.directory, `${username}.json`);
      try { await readFile(target); throw failure(409, 'Username already exists.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const salt = randomBytes(16).toString('hex');
      const hash = (await scrypt(body.password, salt, 64)).toString('hex');
      const user = { username, salt, hash, createdAt: new Date().toISOString() };
      const temporary = `${target}.${randomBytes(8).toString('hex')}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(user), { mode: 0o600, flag: 'wx' });
        await rename(temporary, target);
      } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      return { username, createdAt: user.createdAt };
    });
    this.registration = task;
    return task;
  }
  async login(body, address) {
    const now = Date.now();
    for (const [key, attempt] of this.attempts) if (attempt.until <= now) this.attempts.delete(key);
    const attempt = this.attempts.get(address) || { count: 0, until: now + 60_000 };
    if (attempt.count >= 10) throw failure(429, 'Too many login attempts. Try again in one minute.');
    attempt.count++; this.attempts.set(address, attempt);
    const denied = () => failure(401, 'Invalid username or password.');
    if (typeof body?.username !== 'string' || !usernamePattern.test(body.username) || typeof body?.password !== 'string' || body.password.length > 128) throw denied();
    const username = body.username.toLowerCase();
    let user;
    try { user = JSON.parse(await readFile(join(this.directory, `${username}.json`), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const hash = await scrypt(body.password, user?.salt || 'missing-user-dummy-salt', 64);
    if (!user || !timingSafeEqual(hash, Buffer.from(user.hash, 'hex'))) throw denied();
    for (const [key, session] of this.sessions) if (session.expiresAt <= now) this.sessions.delete(key);
    this.attempts.delete(address);
    const token = randomBytes(32).toString('hex');
    const expiresAt = now + 8 * 60 * 60 * 1000;
    this.sessions.set(token, { username, expiresAt });
    return { token, username, expiresAt: new Date(expiresAt).toISOString() };
  }
  session(token) {
    const session = this.sessions.get(token);
    if (session && session.expiresAt > Date.now()) return session;
    this.sessions.delete(token);
    return null;
  }
  logout(token) { this.sessions.delete(token); }
}
