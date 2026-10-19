import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { validateProject } from '../src/project.js';
import { chordPitches } from '../src/notation.js';

function fixture() {
  return { version: 1, id: randomUUID(), title: '테스트 스케치', bpm: 96, bars: 8, instrument: 'soft', notes: [{ id: randomUUID(), pitch: 60, step: 0, length: 4, velocity: .8 }], drums: { kick: [0, 8], snare: [4], hat: [2] }, mixer: { keys: { volume: .7, mute: false }, drums: { volume: .5, mute: false }, voice: { volume: .8, mute: false } }, recording: null, updatedAt: new Date().toISOString() };
}
async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'mumak-api-'));
  const app = await createApp({ dataDir: directory, ...options });
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(async () => { await new Promise(resolve => app.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { directory, request: (path, init) => fetch(`http://127.0.0.1:${app.address().port}/api${path}`, init) };
}
const put = (project, headers = {}) => ({ method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(project) });

test('create, list, reload persisted content, update and delete a project', async t => {
  const { request, directory } = await setup(t); const p = fixture();
  assert.equal((await request(`/projects/${p.id}`, put(p))).status, 200);
  const loaded = await (await request(`/projects/${p.id}`)).json();
  assert.deepEqual(loaded.notes, p.notes);
  assert.equal(JSON.parse(await readFile(join(directory, `${p.id}.json`), 'utf8')).title, p.title);
  const list = await (await request('/projects')).json();
  assert.equal(list.projects.length, 1); assert.equal('notes' in list.projects[0], false);
  assert.equal((await request(`/projects/${p.id}`, put({ ...p, title: '수정됨' }))).status, 200);
  assert.equal((await (await request(`/projects/${p.id}`)).json()).title, '수정됨');
  assert.equal((await request(`/projects/${p.id}`, { method: 'DELETE' })).status, 204);
  assert.equal((await request(`/projects/${p.id}`)).status, 404);
});
test('reject invalid origins and tokens; allow configured preflight', async t => {
  const { request } = await setup(t, { token: 'secret-test-token' });
  assert.equal((await request('/projects')).status, 401);
  assert.equal((await request('/projects', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await request('/projects', { headers: { Authorization: 'Bearer secret-test-token' } })).status, 200);
  assert.equal((await request('/projects', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  const preflight = await request('/projects', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5173' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
});
test('reject malformed JSON, mismatched IDs, traversal and overlarge payloads', async t => {
  const { request } = await setup(t, { maxBytes: 2048 }); const p = fixture();
  assert.equal((await request('/projects/not-a-uuid')).status, 400);
  assert.equal((await request('/projects/%2e%2e%2fsecret')).status, 400);
  assert.equal((await request(`/projects/${p.id}`, put({ ...p, id: randomUUID() }))).status, 400);
  assert.equal((await request(`/projects/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await request(`/projects/${p.id}`, put({ ...p, title: 'x'.repeat(3000) }))).status, 413);
  assert.equal((await request(`/projects/${p.id}`, { method: 'PUT', body: '{}' })).status, 415);
});
test('project validator enforces timing, note IDs, mixer and audio data constraints', () => {
  const p = fixture(); assert.equal(validateProject(p).title, p.title);
  for (const invalid of [
    { ...p, bpm: 0 }, { ...p, notes: [{ ...p.notes[0], step: 127, length: 2 }] },
    { ...p, notes: [p.notes[0], p.notes[0]] }, { ...p, drums: { ...p.drums, kick: [0, 0] } },
    { ...p, recording: { dataUrl: 'https://example.com/private', offset: 0, duration: 2 } },
    { ...p, mixer: { ...p.mixer, keys: { volume: 9, mute: false } } },
  ]) assert.throws(() => validateProject(invalid));
});

test('staff chords and enharmonic spellings survive API persistence', async t => {
  const { request } = await setup(t); const p = fixture();
  p.notes = [{ id: randomUUID(), pitch: 70, spelling: 'Bb4', step: 16, length: 8, velocity: .7 }];
  p.chords = [{ id: randomUUID(), symbol: 'G7', step: 32, length: 16 }, { id: randomUUID(), symbol: 'Bbmaj7', step: 16, length: 8 }];
  assert.equal((await request(`/projects/${p.id}`, put(p))).status, 200);
  const loaded = await (await request(`/projects/${p.id}`)).json();
  assert.deepEqual(loaded.notes, p.notes); assert.deepEqual(loaded.chords, [p.chords[1], p.chords[0]], 'chords are stored sorted by position');
  assert.equal((await request(`/projects/${p.id}`, put({ ...p, chords: [{ ...p.chords[0], symbol: 'H7' }] }))).status, 400);
  assert.equal((await request(`/projects/${p.id}`, put({ ...p, chords: [p.chords[0], { ...p.chords[1], step: 32 }] }))).status, 400);
  assert.throws(() => validateProject({ ...p, notes: p.notes.map(n => ({ ...n, spelling: 'C4' })) }));
  // Legacy clients attached generated note IDs to chords; the field is tolerated and stripped.
  assert.deepEqual(validateProject({ ...p, chords: [{ ...p.chords[1], noteIds: [randomUUID()] }] }).chords, [p.chords[1]]);
  assert.throws(() => validateProject({ ...p, chords: [{ ...p.chords[1], noteIds: [1] }] }));
  assert.deepEqual(validateProject(fixture()).chords, []);
  assert.equal(chordPitches('B#aug'), null);
});

test('key signatures persist and only canonical names are accepted', async t => {
  const { request } = await setup(t); const p = fixture();
  assert.equal(validateProject(p).key, null);
  assert.equal((await request(`/projects/${p.id}`, put({ ...p, key: { tonic: 'Gb', mode: 'major' } }))).status, 200);
  assert.deepEqual((await (await request(`/projects/${p.id}`)).json()).key, { tonic: 'Gb', mode: 'major' });
  assert.equal((await request(`/projects/${p.id}`, put({ ...p, key: null }))).status, 200);
  assert.equal((await (await request(`/projects/${p.id}`)).json()).key, null);
  for (const invalid of [{ tonic: 'H', mode: 'major' }, { tonic: 'Gb', mode: 'minor' }, { tonic: 'F#', mode: 'major' }, { tonic: 'C', mode: 'dorian' }, 'G', 7]) {
    assert.throws(() => validateProject({ ...p, key: invalid }), JSON.stringify(invalid));
  }
  assert.deepEqual(validateProject({ ...p, key: { tonic: 'F#', mode: 'minor', extra: true } }).key, { tonic: 'F#', mode: 'minor' });
});

test('accompaniment pattern defaults to four beats and persists', async t => {
  const { request } = await setup(t); const p = fixture();
  assert.deepEqual(validateProject(p).accompaniment, { pattern: 'quarter' });
  assert.equal((await request(`/projects/${p.id}`, put({ ...p, accompaniment: { pattern: 'eighth' } }))).status, 200);
  assert.deepEqual((await (await request(`/projects/${p.id}`)).json()).accompaniment, { pattern: 'eighth' });
  for (const invalid of [{ pattern: 'swing' }, 'quarter', null, {}]) assert.throws(() => validateProject({ ...p, accompaniment: invalid }), JSON.stringify(invalid));
});

test('chord suggestion endpoint ranks diatonic chords and validates input', async t => {
  const { request } = await setup(t, { token: 'secret-test-token' });
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer secret-test-token' };
  const body = { step: 16, length: 16, chords: [{ symbol: 'G7', step: 0, length: 16 }], notes: [{ pitch: 64, step: 16, length: 8 }] };
  const response = await request('/harmony/suggest', { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.key.label, 'C 장조'); assert.equal(result.suggestions[0].symbol, 'C'); assert.equal(result.progressions.length, 4);
  assert.equal((await request('/harmony/suggest', { method: 'POST', headers, body: JSON.stringify({ step: 200 }) })).status, 400);
  assert.equal((await request('/harmony/suggest', { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await request('/harmony/suggest', { method: 'POST', headers: { Authorization: headers.Authorization }, body: '{}' })).status, 415);
  assert.equal((await request('/harmony/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await request('/harmony/suggest', { headers })).status, 405);
  const preflight = await request('/harmony/suggest', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:5173' } });
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
});
