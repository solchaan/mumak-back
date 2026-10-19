import { mkdir, readdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ID } from './project.js';

export class ProjectStore {
  constructor(directory) { this.directory = directory; }
  async init() { await mkdir(this.directory, { recursive: true }); }
  path(id) {
    if (!ID.test(id)) throw Object.assign(new Error('Invalid project ID.'), { status: 400 });
    return join(this.directory, `${id}.json`);
  }
  async get(id) {
    try { return JSON.parse(await readFile(this.path(id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw Object.assign(new Error('Project not found.'), { status: 404 }); throw error; }
  }
  async list() {
    const files = (await readdir(this.directory)).filter(f => f.endsWith('.json') && ID.test(f.slice(0, -5)));
    const projects = await Promise.all(files.map(f => this.get(f.slice(0, -5)).catch(e => { if (e.status === 404) return null; throw e; })));
    return projects.filter(Boolean).map(({ id, title, bpm, updatedAt }) => ({ id, title, bpm, updatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async put(project) {
    const target = this.path(project.id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(project), { flag: 'wx', mode: 0o600 });
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
    return project;
  }
  async delete(id) {
    try { await unlink(this.path(id)); }
    catch (error) { if (error.code === 'ENOENT') throw Object.assign(new Error('Project not found.'), { status: 404 }); throw error; }
  }
}
