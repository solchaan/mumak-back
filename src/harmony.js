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
// Maps a chord symbol to its scale-degree function in the key ('V', 'V7', 'ii7' …), or null for non-diatonic chords.
export function romanOf(symbol, tonic, mode) {
  const pitches = chordPitches(symbol);
  if (!pitches) return null;
  const offset = (pitches[0] - tonic + 120) % 12;
  const shape = pitches.map(p => p - pitches[0]).join(',');
  const matches = quality => { const p = chordPitches(SHARP[(tonic + offset) % 12] + quality); return !!p && p.map(x => x - p[0]).join(',') === shape; };
  for (const d of DEGREES[mode]) {
    if (d.offset !== offset) continue;
    if (matches(d.quality)) return d.roman;
    if (matches(d.seventh)) return d.roman + '7';
  }
  return null;
}
const baseRoman = roman => roman && roman.replace(/7$/, '');

export function parseSuggestRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Request body must be a JSON object.');
  const bars = body.bars === undefined ? 8 : body.bars;
  if (!integer(bars, 1, 256)) fail('bars must be an integer from 1 to 256.');
  const STEPS = bars * 16;
  const step = body.step === undefined ? 0 : body.step;
  if (!integer(step, 0, STEPS - 1)) fail('step must be an integer inside the project timeline.');
  const length = body.length === undefined ? Math.min(16, STEPS - step) : body.length;
  if (!integer(length, 1, STEPS - step)) fail('length must fit inside the project timeline.');
  const limit = body.limit === undefined ? 6 : body.limit;
  if (!integer(limit, 1, 12)) fail('limit must be an integer from 1 to 12.');
  const notes = body.notes === undefined ? [] : body.notes;
  if (!Array.isArray(notes) || notes.length > bars * 64) fail('notes must be an array of at most 64 items per bar.');
  for (const n of notes) {
    if (!n || !integer(n.pitch, 0, 127) || !integer(n.step, 0, STEPS - 1) || !integer(n.length, 1, STEPS - n.step)) fail('Invalid note.');
    if (n.velocity !== undefined && !(typeof n.velocity === 'number' && n.velocity >= 0 && n.velocity <= 1)) fail('Invalid note velocity.');
    if (n.id !== undefined && (typeof n.id !== 'string' || n.id.length > 64)) fail('Invalid note ID.');
  }
  const chords = body.chords === undefined ? [] : body.chords;
  if (!Array.isArray(chords) || chords.length > STEPS) fail('chords must be an array of at most 16 items per bar.');
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
    bars, step, length, limit, key,
    notes: notes.map(n => ({ id: n.id, pitch: n.pitch, step: n.step, length: n.length, velocity: n.velocity ?? .7 })),
    chords: chords.map(c => ({ symbol: c.symbol, step: c.step, length: c.length, noteIds: c.noteIds || [] })).sort((a, b) => a.step - b.step),
  };
}

const POPULAR = {
  major: [['I', 'V', 'vi', 'IV', 'I–V–vi–IV는 수많은 팝송이 쓰는 진행이에요. 밝게 시작해 vi에서 살짝 가라앉았다가 IV로 다시 열리는 흐름이 특징이에요.'], ['vi', 'IV', 'I', 'V', 'vi–IV–I–V는 단조처럼 시작해 장조로 풀리는 진행이에요. 애절한 분위기의 팝·록에서 자주 들려요.'], ['I', 'vi', 'IV', 'V', 'I–vi–IV–V는 1950년대 두왑부터 발라드까지 쓰이는 고전 진행이에요. 어디에 써도 안정적이에요.'], ['ii', 'V', 'I', null, 'ii–V–I는 재즈와 팝에서 가장 기본이 되는 마침 공식이에요. 긴장(ii→V)에서 해결(I)로 가는 흐름을 느껴 보세요.']],
  minor: [['i', 'VI', 'III', 'VII', 'i–VI–III–VII는 단조의 대표 진행이에요. 어둡게 시작해 III·VII에서 밝은 색이 스치는 것이 매력이에요.'], ['i', 'iv', 'VI', 'V', 'i–iv–VI–V는 V(장3화음)로 돌아오는 긴장이 큰 단조 진행이에요. 드라마틱한 마무리에 좋아요.'], ['i', 'VII', 'VI', 'V', 'i–VII–VI–V는 베이스가 계단처럼 내려가는 안달루시아 진행이에요. 플라멩코·록에서 자주 들려요.'], ['ii°', 'V', 'i', null, 'ii°–V–i는 단조의 기본 마침 공식이에요. V를 V7으로 쓰면 해결감이 더 강해져요.']],
};
// Study notes about the whole progression: what works, what may sound flat, and what to try next.
export function progressionTips(request, key) {
  const { chords, notes } = request;
  const { tonic, mode } = key;
  const tips = [];
  const add = (level, text) => { if (!tips.some(t => t.text === text)) tips.push({ level, text }); };
  const tonicRoman = mode === 'major' ? 'I' : 'i';
  if (!chords.length) { add('info', '코드가 아직 없어요. 으뜸화음(I)으로 시작하거나 추천 진행을 적용해 보고, 들리는 느낌을 비교해 보세요.'); return tips; }
  const romans = chords.map(c => romanOf(c.symbol, tonic, mode));
  const bases = romans.map(r => r && r.replace(/7$/, ''));
  const symbols = chords.map(c => c.symbol);
  const distinct = new Set(symbols);
  const scale = new Set(SCALES[mode].map(o => (tonic + o) % 12));
  for (const [a, b, c, d, text] of POPULAR[mode]) {
    const pattern = [a, b, c, d].filter(Boolean);
    for (let i = 0; i + pattern.length <= bases.length; i++) if (pattern.every((roman, j) => bases[i + j] === roman)) { add('good', text); break; }
  }
  if (chords.length >= 3 && distinct.size === 1) add('warn', `${symbols[0]} 하나만 ${chords.length}번 이어져요. 같은 코드가 계속되면 단조로울 수 있어요. 중간에 IV나 V를 넣어 흐름을 만들어 보세요.`);
  else if (chords.length >= 4 && distinct.size === 2) add('info', '두 코드만 번갈아 쓰고 있어요. 반복은 안정감을 주지만, 뒤쪽 마디에 새 코드를 하나 넣으면 전개가 생겨요.');
  let run = 1;
  for (let i = 1; i < symbols.length; i++) {
    run = symbols[i] === symbols[i - 1] ? run + 1 : 1;
    if (run === 3 && distinct.size > 1) { add('info', `${symbols[i]}가 세 번 이상 연달아 나와요. 길게 머무는 코드는 같은 기능의 다른 코드(예: I ↔ vi, IV ↔ ii)로 바꿔 변화를 줄 수 있어요.`); break; }
  }
  const lastChord = chords[chords.length - 1], lastBase = bases[bases.length - 1];
  if (lastChord.step + lastChord.length >= (request.bars ?? 8) * 16 - 8) {
    if (lastBase === tonicRoman) add('good', '마지막이 으뜸화음으로 끝나 마침 느낌이 분명해요.');
    else if (lastBase === 'V') add('info', '마지막이 V로 끝나 "다음이 이어질 것 같은" 반종지예요. 반복 구간에는 잘 어울리고, 끝맺음이 필요하면 I로 마무리해 보세요.');
    else add('info', `마지막 코드 ${lastChord.symbol}${lastBase ? ` (${lastBase})` : ''}는 끝맺음이 열려 있어요. 분명히 마치려면 V → I로 닫아 보세요.`);
  } else add('info', '마지막 마디까지 코드가 이어지지 않아요. 끝까지 채우면 반복 재생이 자연스러워져요.');
  if (chords.length >= 3 && !bases.includes('V') && !bases.includes('vii°')) add('info', 'V(딸림화음)가 한 번도 없어요. V는 으뜸화음으로 돌아가려는 긴장을 만들어 줘요. 마디 끝에 V나 V7을 넣어 보세요.');
  if (chords.length >= 4 && !['IV', 'ii', 'iv', 'ii°'].some(r => bases.includes(r))) add('info', 'IV·ii 같은 버금딸림 기능이 없어요. I와 V 사이에 IV를 넣으면 흐름이 부드러워져요.');
  for (let i = 1; i < bases.length; i++) if (bases[i - 1] === 'V' && bases[i] === 'IV') { add('info', 'V 다음에 IV가 와요. 고전 화성에서는 약한 진행으로 보지만 록·블루스에서는 흔한 소리예요. 의도한 느낌이면 괜찮아요.'); break; }
  const foreign = [...new Set(chords.filter((_, i) => !romans[i]).map(c => c.symbol))];
  if (foreign.length) add('info', `${foreign.join(', ')}는 ${keyName(tonic, mode)} ${mode === 'major' ? '장조' : '단조'} 밖의 코드예요. 차용화음이나 전조처럼 색을 더하지만, 어색하게 들리면 같은 조의 코드로 바꿔 보세요.`);
  if (chords.length >= 4 && chords.every(c => !/(maj7|m7b5|dim7|m7|7|6)$/.test(c.symbol))) add('info', '모두 3화음이에요. V를 V7으로, I를 Imaj7으로 바꾸면 색채가 풍부해져요.');
  if (chords[0].step === 0 && bases[0] && bases[0] !== tonicRoman) add('info', `${symbols[0]} (${bases[0]})로 시작해요. 으뜸화음이 아닌 시작은 신선하지만 조성이 모호해질 수 있어요. 의도한 효과인지 들어 보세요.`);
  const perBar = new Map();
  for (const c of chords) perBar.set(Math.floor(c.step / 16), (perBar.get(Math.floor(c.step / 16)) || 0) + 1);
  if (Math.max(...perBar.values()) >= 4) add('info', '한 마디에 코드가 4개 이상인 곳이 있어요. 빠른 코드 체인지는 긴장감을 주지만, 보컬 라인이 묻히면 코드를 줄여 보세요.');
  let clashes = 0;
  for (const c of chords) {
    const tones = new Set((chordPitches(c.symbol) || []).map(p => p % 12));
    for (const n of notes) if (n.step % 4 === 0 && n.step >= c.step && n.step < c.step + c.length && !tones.has(n.pitch % 12) && !scale.has(n.pitch % 12)) clashes++;
  }
  if (clashes >= 2) add('warn', `센 박의 멜로디 음이 코드에도 조성에도 없는 곳이 ${clashes}군데 있어요. 의도한 긴장이 아니면 멜로디를 코드 구성음으로 옮기거나 코드를 바꿔 보세요.`);
  return tips.slice(0, 6);
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
  const previousBase = baseRoman(previousRoman), nextBase = baseRoman(nextRoman);
  const end = step + length;
  const melody = notes.filter(n => !replaced.has(n.id) && n.step < end && n.step + n.length > step);
  const totalOverlap = melody.reduce((s, n) => s + Math.min(n.step + n.length, end) - Math.max(n.step, step), 0);

  const ranked = candidates(tonic, mode).map(candidate => {
    const base = candidate.roman.replace(/7$/, '');
    const tones = new Set(chordPitches(candidate.symbol).map(p => p % 12));
    const reasons = [];
    let score = 0;
    if (previous && previousBase) {
      const transition = TRANSITIONS[mode][previousBase]?.[base] ?? 0;
      score += transition * candidate.weight;
      if (transition >= .8) reasons.push(`${previousBase} → ${base} 진행`);
    } else if (previous) {
      score += .4 * candidate.weight;
    } else {
      score += OPENINGS[mode][base] * candidate.weight;
      if (OPENINGS[mode][base] >= .5) reasons.push('여는 코드');
    }
    if (nextBase) {
      const into = TRANSITIONS[mode][base]?.[nextBase] ?? 0;
      score += .5 * into;
      if (into >= .8) reasons.push(`다음 ${nextBase}로 자연스럽게 연결`);
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
    if (end === (request.bars ?? 8) * 16) {
      if (base === 'I' || base === 'i') { score += .6; reasons.push('마침 코드'); }
      else if (base === 'V') { score += .2; reasons.push('반종지'); }
    }
    if (previous && previous.symbol === candidate.symbol) score -= .3;
    return { symbol: candidate.symbol, roman: candidate.roman, score: Math.round(score * 100) / 100, reason: reasons.join(' · ') || '같은 조의 코드' };
  }).sort((a, b) => b.score - a.score || a.roman.length - b.roman.length);

  const progressions = PRESETS[mode].map(pattern => {
    const symbols = pattern.map(roman => degreeSymbol(tonic, mode, roman));
    return { name: pattern.join('–'), symbols, chords: Array.from({ length: request.bars ?? 8 }, (_, bar) => ({ symbol: symbols[bar % 4], step: bar * 16, length: 16 })) };
  });
  return {
    key: { tonic: keyName(tonic, mode), mode, label: `${keyName(tonic, mode)} ${mode === 'major' ? '장조' : '단조'}`, confidence: key.confidence, estimated: !request.key },
    position: { step, length },
    previous: previous ? { symbol: previous.symbol, roman: previousRoman } : null,
    suggestions: ranked.slice(0, limit),
    progressions,
    analysis: { romans: chords.map(c => ({ symbol: c.symbol, step: c.step, roman: romanOf(c.symbol, tonic, mode) })) },
    tips: progressionTips(request, key),
  };
}
