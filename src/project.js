import { chordPitches, spellingPitch } from './notation.js';
import { KEY_NAMES } from './harmony.js';
export const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const bounded = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const integer = (v, min, max) => Number.isInteger(v) && bounded(v, min, max);
const fail = (message) => { const error = new Error(message); error.status = 400; throw error; };

export function validateProject(p) {
  if (!p || typeof p !== 'object' || p.version !== 1 || !ID.test(p.id)) fail('Invalid project version or ID.');
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 100) fail('Title must contain 1–100 characters.');
  if (!integer(p.bars, 1, 256) || !integer(p.bpm, 40, 240) || !['soft', 'pluck', 'synth'].includes(p.instrument)) fail('Invalid project settings.');
  if (!Array.isArray(p.notes) || p.notes.length > p.bars * 64) fail('Too many notes.');
  const ids = new Set();
  for (const n of p.notes) {
    if (!n || !ID.test(n.id) || ids.has(n.id) || !integer(n.pitch, 60, 84) || !integer(n.step, 0, p.bars * 16 - 1) || !integer(n.length, 1, p.bars * 16 - n.step) || !bounded(n.velocity, 0.01, 1)) fail('Invalid note.');
    if (n.spelling !== undefined && spellingPitch(n.spelling) !== n.pitch) fail('Invalid note spelling.');
    ids.add(n.id);
  }
  const chords = p.chords === undefined ? [] : p.chords;
  if (!Array.isArray(chords) || chords.length > p.bars * 16) fail('Invalid chords.');
  const chordIds = new Set(), starts = new Set();
  for (const c of chords) {
    // Lead-sheet chords are symbols with a position and duration; their tones are rendered by the client, not stored as notes.
    if (!c || !ID.test(c.id) || chordIds.has(c.id) || !integer(c.step, 0, p.bars * 16 - 1) || starts.has(c.step) || !integer(c.length, 1, p.bars * 16 - c.step) || !chordPitches(c.symbol)) fail('Invalid chord.');
    // Older clients sent generated chord-tone note IDs; accept the field for compatibility but never persist it.
    if (c.noteIds !== undefined && (!Array.isArray(c.noteIds) || c.noteIds.length > 8 || c.noteIds.some(id => typeof id !== 'string'))) fail('Invalid chord note references.');
    chordIds.add(c.id); starts.add(c.step);
  }
  // Chord accompaniment pattern; files written before the setting existed play four beats per bar.
  const accompaniment = p.accompaniment === undefined ? { pattern: 'quarter' } : p.accompaniment;
  if (!accompaniment || typeof accompaniment !== 'object' || !['quarter', 'half', 'eighth', 'whole'].includes(accompaniment.pattern)) fail('Invalid accompaniment pattern.');
  const signature = p.key === undefined ? null : p.key;
  if (signature !== null && (!signature || typeof signature !== 'object' || !KEY_NAMES[signature.mode]?.includes(signature.tonic))) fail('Invalid key signature.');
  for (const key of ['kick', 'snare', 'hat']) {
    const steps = p.drums?.[key];
    if (!Array.isArray(steps) || steps.length > p.bars * 16 || steps.some(s => !integer(s, 0, p.bars * 16 - 1)) || new Set(steps).size !== steps.length) fail('Invalid drum pattern.');
  }
  for (const key of ['keys', 'drums', 'voice']) {
    if (!bounded(p.mixer?.[key]?.volume, 0, 1) || typeof p.mixer[key].mute !== 'boolean') fail('Invalid mixer settings.');
  }
  if (p.recording !== null) {
    const r = p.recording;
    if (!r || !bounded(r.duration, 0.01, 256 * 6 + 5) || !bounded(r.offset, -5, 48) || typeof r.dataUrl !== 'string' || r.dataUrl.length > 28_000_000 || !/^data:audio\/[a-z0-9.+-]+(?:;codecs=[a-z0-9.,-]+)?;base64,[A-Za-z0-9+/]+={0,2}$/i.test(r.dataUrl)) fail('Invalid recording (maximum 20 MB).');
  }
  // Only persist documented fields; never accept paths or arbitrary metadata.
  return {
    version: 1, id: p.id, title: p.title.trim(), bars: p.bars, bpm: p.bpm, instrument: p.instrument,
    notes: p.notes.map(({ id, pitch, step, length, velocity, spelling }) => ({ id, pitch, step, length, velocity, ...(spelling === undefined ? {} : { spelling }) })),
    chords: chords.map(({ id, symbol, step, length }) => ({ id, symbol, step, length })).sort((a, b) => a.step - b.step),
    key: signature === null ? null : { tonic: signature.tonic, mode: signature.mode },
    accompaniment: { pattern: accompaniment.pattern },
    drums: Object.fromEntries(['kick', 'snare', 'hat'].map(k => [k, [...p.drums[k]].sort((a, b) => a - b)])),
    mixer: Object.fromEntries(['keys', 'drums', 'voice'].map(k => [k, { volume: p.mixer[k].volume, mute: p.mixer[k].mute }])),
    recording: p.recording === null ? null : { dataUrl: p.recording.dataUrl, duration: p.recording.duration, offset: p.recording.offset },
    updatedAt: new Date().toISOString(),
  };
}
