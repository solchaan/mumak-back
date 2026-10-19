import { chordPitches, spellingPitch } from './notation.js';
export const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const bounded = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const integer = (v, min, max) => Number.isInteger(v) && bounded(v, min, max);
const fail = (message) => { const error = new Error(message); error.status = 400; throw error; };

export function validateProject(p) {
  if (!p || typeof p !== 'object' || p.version !== 1 || !ID.test(p.id)) fail('Invalid project version or ID.');
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 100) fail('Title must contain 1–100 characters.');
  if (p.bars !== 8 || !integer(p.bpm, 40, 240) || !['soft', 'pluck', 'synth'].includes(p.instrument)) fail('Invalid project settings.');
  if (!Array.isArray(p.notes) || p.notes.length > 512) fail('Maximum 512 notes.');
  const ids = new Set();
  for (const n of p.notes) {
    if (!n || !ID.test(n.id) || ids.has(n.id) || !integer(n.pitch, 60, 84) || !integer(n.step, 0, 127) || !integer(n.length, 1, 128 - n.step) || !bounded(n.velocity, 0.01, 1)) fail('Invalid note.');
    if (n.spelling !== undefined && spellingPitch(n.spelling) !== n.pitch) fail('Invalid note spelling.');
    ids.add(n.id);
  }
  const chords = p.chords === undefined ? [] : p.chords;
  if (!Array.isArray(chords) || chords.length > 128) fail('Invalid chords.');
  const chordIds = new Set(), starts = new Set(), claimed = new Set();
  for (const c of chords) {
    if (!c || !ID.test(c.id) || chordIds.has(c.id) || !integer(c.step, 0, 127) || starts.has(c.step) || !integer(c.length, 1, 128 - c.step) || !Array.isArray(c.noteIds)) fail('Invalid chord.');
    const pitches = chordPitches(c.symbol);
    if (!pitches || pitches.length !== c.noteIds.length || new Set(c.noteIds).size !== c.noteIds.length) fail('Invalid chord symbol or tones.');
    const actual = c.noteIds.map(id => {
      const note = p.notes.find(n => n.id === id);
      if (!note || claimed.has(id) || note.step !== c.step || note.length !== c.length) fail('Invalid chord note reference.');
      claimed.add(id); return note.pitch;
    }).sort((a, b) => a - b);
    if (actual.some((pitch, i) => pitch !== pitches[i])) fail('Chord tones do not match the symbol.');
    chordIds.add(c.id); starts.add(c.step);
  }
  for (const key of ['kick', 'snare', 'hat']) {
    const steps = p.drums?.[key];
    if (!Array.isArray(steps) || steps.length > 128 || steps.some(s => !integer(s, 0, 127)) || new Set(steps).size !== steps.length) fail('Invalid drum pattern.');
  }
  for (const key of ['keys', 'drums', 'voice']) {
    if (!bounded(p.mixer?.[key]?.volume, 0, 1) || typeof p.mixer[key].mute !== 'boolean') fail('Invalid mixer settings.');
  }
  if (p.recording !== null) {
    const r = p.recording;
    if (!r || !bounded(r.duration, 0.01, 120) || !bounded(r.offset, -5, 48) || typeof r.dataUrl !== 'string' || r.dataUrl.length > 28_000_000 || !/^data:audio\/[a-z0-9.+-]+(?:;codecs=[a-z0-9.,-]+)?;base64,[A-Za-z0-9+/]+={0,2}$/i.test(r.dataUrl)) fail('Invalid recording (maximum 20 MB / 120 seconds).');
  }
  // Only persist documented fields; never accept paths or arbitrary metadata.
  return {
    version: 1, id: p.id, title: p.title.trim(), bars: 8, bpm: p.bpm, instrument: p.instrument,
    notes: p.notes.map(({ id, pitch, step, length, velocity, spelling }) => ({ id, pitch, step, length, velocity, ...(spelling === undefined ? {} : { spelling }) })),
    chords: chords.map(({ id, symbol, step, length, noteIds }) => ({ id, symbol, step, length, noteIds: [...noteIds] })),
    drums: Object.fromEntries(['kick', 'snare', 'hat'].map(k => [k, [...p.drums[k]].sort((a, b) => a - b)])),
    mixer: Object.fromEntries(['keys', 'drums', 'voice'].map(k => [k, { volume: p.mixer[k].volume, mute: p.mixer[k].mute }])),
    recording: p.recording === null ? null : { dataUrl: p.recording.dataUrl, duration: p.recording.duration, offset: p.recording.offset },
    updatedAt: new Date().toISOString(),
  };
}
