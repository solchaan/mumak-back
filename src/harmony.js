import { chordPitches } from './notation.js';

// Rule-based chord suggestions: estimate the key from the sketch, then rank diatonic chords
// by functional-harmony transitions, melody fit and cadence position. No external services.
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const FLAT_KEYS = { major: new Set([5, 10, 3, 8, 1, 6]), minor: new Set([2, 7, 0, 5, 10, 3]) };
// Krumhansl-Kessler key profiles.
const PROFILES = {
  major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
  minor: [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
};
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10, 11] };
const DEGREES = {
  major: [
    { offset: 0, quality: '', seventh: 'maj7', roman: 'I' }, { offset: 2, quality: 'm', seventh: 'm7', roman: 'ii' },
    { offset: 4, quality: 'm', seventh: 'm7', roman: 'iii' }, { offset: 5, quality: '', seventh: 'maj7', roman: 'IV' },
    { offset: 7, quality: '', seventh: '7', roman: 'V' }, { offset: 9, quality: 'm', seventh: 'm7', roman: 'vi' },
    { offset: 11, quality: 'dim', seventh: 'm7b5', roman: 'vii°' },
  ],
  minor: [
    { offset: 0, quality: 'm', seventh: 'm7', roman: 'i' }, { offset: 2, quality: 'dim', seventh: 'm7b5', roman: 'ii°' },
    { offset: 3, quality: '', seventh: 'maj7', roman: 'III' }, { offset: 5, quality: 'm', seventh: 'm7', roman: 'iv' },
    { offset: 7, quality: 'm', seventh: 'm7', roman: 'v' }, { offset: 7, quality: '', seventh: '7', roman: 'V' },
    { offset: 8, quality: '', seventh: 'maj7', roman: 'VI' }, { offset: 10, quality: '', seventh: '7', roman: 'VII' },
  ],
};
const TRANSITIONS = {
  major: {
    I: { IV: 1, V: .95, vi: .9, ii: .8, iii: .5, 'vii°': .3 }, ii: { V: 1, 'vii°': .5, IV: .4, I: .3, vi: .3 },
    iii: { vi: 1, IV: .8, ii: .5, I: .3 }, IV: { V: 1, I: .9, ii: .6, 'vii°': .4, vi: .4 },
    V: { I: 1, vi: .8, IV: .5, ii: .2 }, vi: { IV: 1, ii: .9, V: .8, I: .5, iii: .4 }, 'vii°': { I: 1, iii: .5, vi: .3 },
  },
  minor: {
    i: { iv: 1, VI: .9, V: .85, VII: .8, 'ii°': .6, III: .6, v: .4 }, 'ii°': { V: 1, i: .4, VII: .3 },
    III: { VI: 1, iv: .8, VII: .7, i: .4 }, iv: { V: 1, i: .9, VII: .7, VI: .5, 'ii°': .3 },
    v: { VI: .9, i: .8, iv: .4 }, V: { i: 1, VI: .8, iv: .3 },
    VI: { VII: 1, iv: .8, V: .7, 'ii°': .6, III: .6 }, VII: { III: 1, i: .8, VI: .6, iv: .3 },
  },
};
const OPENINGS = {
  major: { I: 1, vi: .6, IV: .5, ii: .4, V: .3, iii: .2, 'vii°': .1 },
  minor: { i: 1, VI: .5, iv: .5, VII: .3, III: .3, V: .3, 'ii°': .2, v: .2 },
};
const PRESETS = {
  major: [['I', 'V', 'vi', 'IV'], ['I', 'vi', 'IV', 'V'], ['vi', 'IV', 'I', 'V'], ['ii', 'V', 'I', 'vi']],
  minor: [['i', 'VI', 'III', 'VII'], ['i', 'iv', 'VI', 'V'], ['i', 'VII', 'VI', 'V'], ['VI', 'VII', 'i', 'i']],
};
const STEPS = 128;
const fail = (message) => { const error = new Error(message); error.status = 400; throw error; };
const integer = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const pitchClass = (name) => { const i = SHARP.indexOf(name); return i >= 0 ? i : FLAT.indexOf(name); };
const keyName = (tonic, mode) => (FLAT_KEYS[mode].has(tonic) ? FLAT : SHARP)[tonic];
const rootName = (tonic, mode, offset) => (FLAT_KEYS[mode].has(tonic) ? FLAT : SHARP)[(tonic + offset) % 12];
// Canonical key signature names accepted in stored projects; the frontend's list must match.
export const KEY_NAMES = { major: Array.from({ length: 12 }, (_, i) => keyName(i, 'major')), minor: Array.from({ length: 12 }, (_, i) => keyName(i, 'minor')) };
const degreeSymbol = (tonic, mode, roman) => { const d = DEGREES[mode].find(x => x.roman === roman); return rootName(tonic, mode, d.offset) + d.quality; };

function correlation(a, b) {
  const mean = x => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export function estimateKey(notes, chords) {
  const weights = new Array(12).fill(0);
  for (const n of notes) weights[n.pitch % 12] += n.length * (n.velocity ?? .7);
  for (const c of chords) {
    const pitches = chordPitches(c.symbol) || [];
    pitches.forEach((pitch, i) => { weights[pitch % 12] += c.length * (i === 0 ? 2 : 1); });
    // A dominant seventh strongly implies the key a fifth below its root.
    if (pitches.map(p => p - pitches[0]).join(',') === '0,4,7,10') weights[(pitches[0] + 5) % 12] += c.length * 2;
  }
  if (!weights.some(Boolean)) return { tonic: 0, mode: 'major', confidence: 0 };
  let best = { tonic: 0, mode: 'major', confidence: -1 };
  for (const mode of ['major', 'minor']) for (let tonic = 0; tonic < 12; tonic++) {
    const r = correlation(weights, PROFILES[mode].map((_, i) => PROFILES[mode][(i - tonic + 12) % 12]));
    if (r > best.confidence + 1e-9) best = { tonic, mode, confidence: r };
  }
  return { ...best, confidence: Math.round(Math.max(0, best.confidence) * 100) / 100 };
}

function candidates(tonic, mode) {
  return DEGREES[mode].flatMap(degree => {
    const root = rootName(tonic, mode, degree.offset);
    return [
      { symbol: root + degree.quality, roman: degree.roman, weight: 1 },
      { symbol: root + degree.seventh, roman: degree.roman + '7', weight: degree.roman === 'V' ? .95 : .85 },
    ];
  }).filter(c => chordPitches(c.symbol));
}
// Maps a chord symbol to its scale-degree function in the key, or null for non-diatonic chords.
export function romanOf(symbol, tonic, mode) {
  const pitches = chordPitches(symbol);
  if (!pitches) return null;
  const offset = (pitches[0] - tonic + 120) % 12;
  const shape = pitches.map(p => p - pitches[0]).join(',');
  const degree = DEGREES[mode].find(d => d.offset === offset && [d.quality, d.seventh].some(q => {
    const p = chordPitches(rootName(tonic, mode, d.offset) + q);
    return p && p.map(x => x - p[0]).join(',') === shape;
  }));
  return degree ? degree.roman : null;
}

export function parseSuggestRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Request body must be a JSON object.');
  const step = body.step === undefined ? 0 : body.step;
  if (!integer(step, 0, STEPS - 1)) fail('step must be an integer from 0 to 127.');
  const length = body.length === undefined ? Math.min(16, STEPS - step) : body.length;
  if (!integer(length, 1, STEPS - step)) fail('length must fit inside the 8-bar timeline.');
  const limit = body.limit === undefined ? 6 : body.limit;
  if (!integer(limit, 1, 12)) fail('limit must be an integer from 1 to 12.');
  const notes = body.notes === undefined ? [] : body.notes;
  if (!Array.isArray(notes) || notes.length > 512) fail('notes must be an array of at most 512 items.');
  for (const n of notes) {
    if (!n || !integer(n.pitch, 0, 127) || !integer(n.step, 0, STEPS - 1) || !integer(n.length, 1, STEPS - n.step)) fail('Invalid note.');
    if (n.velocity !== undefined && !(typeof n.velocity === 'number' && n.velocity >= 0 && n.velocity <= 1)) fail('Invalid note velocity.');
    if (n.id !== undefined && (typeof n.id !== 'string' || n.id.length > 64)) fail('Invalid note ID.');
  }
  const chords = body.chords === undefined ? [] : body.chords;
  if (!Array.isArray(chords) || chords.length > 128) fail('chords must be an array of at most 128 items.');
  for (const c of chords) {
    if (!c || typeof c.symbol !== 'string' || c.symbol.length > 12 || !chordPitches(c.symbol) || !integer(c.step, 0, STEPS - 1) || !integer(c.length, 1, STEPS - c.step)) fail('Invalid chord.');
    if (c.noteIds !== undefined && (!Array.isArray(c.noteIds) || c.noteIds.length > 8 || c.noteIds.some(id => typeof id !== 'string' || id.length > 64))) fail('Invalid chord note references.');
  }
  let key = null;
  if (body.key !== undefined && body.key !== null) {
    const tonic = typeof body.key?.tonic === 'string' ? pitchClass(body.key.tonic) : -1;
    if (tonic < 0 || !['major', 'minor'].includes(body.key.mode)) fail('key must be { tonic: "C".."B", mode: "major" | "minor" }.');
    key = { tonic, mode: body.key.mode };
  }
  return {
    step, length, limit, key,
    notes: notes.map(n => ({ id: n.id, pitch: n.pitch, step: n.step, length: n.length, velocity: n.velocity ?? .7 })),
    chords: chords.map(c => ({ symbol: c.symbol, step: c.step, length: c.length, noteIds: c.noteIds || [] })).sort((a, b) => a.step - b.step),
  };
}

export function suggestChords(request) {
  const { step, length, limit, notes, chords } = request;
  const key = request.key ? { ...request.key, confidence: 1 } : estimateKey(notes, chords);
  const { tonic, mode } = key;
  const scale = new Set(SCALES[mode].map(o => (tonic + o) % 12));
  const previous = [...chords].reverse().find(c => c.step < step);
  const next = chords.find(c => c.step >= step + length);
  const replaced = new Set(chords.filter(c => c.step === step).flatMap(c => c.noteIds));
  const previousRoman = previous ? romanOf(previous.symbol, tonic, mode) : null;
  const nextRoman = next ? romanOf(next.symbol, tonic, mode) : null;
  const end = step + length;
  const melody = notes.filter(n => !replaced.has(n.id) && n.step < end && n.step + n.length > step);
  const totalOverlap = melody.reduce((s, n) => s + Math.min(n.step + n.length, end) - Math.max(n.step, step), 0);

  const ranked = candidates(tonic, mode).map(candidate => {
    const base = candidate.roman.replace(/7$/, '');
    const tones = new Set(chordPitches(candidate.symbol).map(p => p % 12));
    const reasons = [];
    let score = 0;
    if (previous && previousRoman) {
      const transition = TRANSITIONS[mode][previousRoman]?.[base] ?? 0;
      score += transition * candidate.weight;
      if (transition >= .8) reasons.push(`${previousRoman} → ${base} 진행`);
    } else if (previous) {
      score += .4 * candidate.weight;
    } else {
      score += OPENINGS[mode][base] * candidate.weight;
      if (OPENINGS[mode][base] >= .5) reasons.push('여는 코드');
    }
    if (nextRoman) {
      const into = TRANSITIONS[mode][base]?.[nextRoman] ?? 0;
      score += .5 * into;
      if (into >= .8) reasons.push(`다음 ${nextRoman}로 자연스럽게 연결`);
    }
    if (totalOverlap) {
      let fit = 0, matched = 0;
      for (const n of melody) {
        const overlap = Math.min(n.step + n.length, end) - Math.max(n.step, step);
        const pc = n.pitch % 12;
        if (tones.has(pc)) { fit += overlap; matched++; }
        else fit += overlap * (scale.has(pc) ? -.15 : -.6);
      }
      score += .8 * fit / totalOverlap;
      if (matched) reasons.push(`멜로디 음 ${matched}개 포함`);
    }
    if (end === STEPS) {
      if (base === 'I' || base === 'i') { score += .6; reasons.push('마침 코드'); }
      else if (base === 'V') { score += .2; reasons.push('반종지'); }
    }
    if (previous && previous.symbol === candidate.symbol) score -= .3;
    return { symbol: candidate.symbol, roman: candidate.roman, score: Math.round(score * 100) / 100, reason: reasons.join(' · ') || '같은 조의 코드' };
  }).sort((a, b) => b.score - a.score || a.roman.length - b.roman.length);

  const progressions = PRESETS[mode].map(pattern => {
    const symbols = pattern.map(roman => degreeSymbol(tonic, mode, roman));
    return { name: pattern.join('–'), symbols, chords: Array.from({ length: 8 }, (_, bar) => ({ symbol: symbols[bar % 4], step: bar * 16, length: 16 })) };
  });
  return {
    key: { tonic: keyName(tonic, mode), mode, label: `${keyName(tonic, mode)} ${mode === 'major' ? '장조' : '단조'}`, confidence: key.confidence, estimated: !request.key },
    position: { step, length },
    previous: previous ? { symbol: previous.symbol, roman: previousRoman } : null,
    suggestions: ranked.slice(0, limit),
    progressions,
  };
}
