import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateKey, parseSuggestRequest, progressionTips, romanOf, suggestChords } from '../src/harmony.js';
import { chordPitches } from '../src/notation.js';

const chord = (symbol, step, length = 16) => ({ symbol, step, length });
const suggest = body => suggestChords(parseSuggestRequest(body));

test('estimates major and minor keys from chords, notes and dominant sevenths', () => {
  assert.deepEqual(estimateKey([], []), { tonic: 0, mode: 'major', confidence: 0 });
  assert.equal(suggest({ chords: [chord('F', 0), chord('Bb', 16), chord('C7', 32)] }).key.label, 'F 장조');
  assert.equal(suggest({ chords: [chord('Am', 0), chord('Dm', 16), chord('E7', 32)] }).key.label, 'A 단조');
  // A lone G7 implies C major even though its tones also fit other keys.
  assert.equal(suggest({ step: 16, chords: [chord('G7', 0)] }).key.label, 'C 장조');
  const melodyOnly = suggest({ notes: [62, 64, 66, 67, 69, 71, 73, 74].map((pitch, i) => ({ pitch, step: i * 4, length: 4 })) });
  assert.equal(melodyOnly.key.label, 'D 장조'); assert.equal(melodyOnly.key.estimated, true);
  const pinned = suggest({ key: { tonic: 'Eb', mode: 'major' } });
  assert.equal(pinned.key.label, 'Eb 장조'); assert.equal(pinned.key.estimated, false); assert.equal(pinned.suggestions[0].symbol, 'Eb');
});

test('ranks functional transitions, cadences and melody fit', () => {
  const opening = suggest({});
  assert.equal(opening.suggestions[0].symbol, 'C'); assert.equal(opening.suggestions[0].roman, 'I');
  assert.match(opening.suggestions[0].reason, /여는 코드/);
  const afterV = suggest({ step: 16, chords: [chord('G7', 0)], notes: [{ pitch: 64, step: 16, length: 8 }] });
  assert.deepEqual(afterV.previous, { symbol: 'G7', roman: 'V7' });
  assert.equal(afterV.suggestions[0].symbol, 'C'); assert.match(afterV.suggestions[0].reason, /V → I 진행 · 멜로디 음 1개 포함/);
  const ending = suggest({ step: 112, length: 16, chords: [chord('F', 0), chord('C', 16), chord('Bb', 32)] });
  assert.equal(ending.key.label, 'F 장조'); assert.equal(ending.suggestions[0].symbol, 'F'); assert.match(ending.suggestions[0].reason, /마침 코드/);
  const toNext = suggest({ step: 16, chords: [chord('C', 0), chord('C', 32)] });
  assert.ok(toNext.suggestions.slice(0, 3).some(s => s.symbol === 'G' && /다음 I로/.test(s.reason)));
  const dissonant = suggest({ step: 0, limit: 12, notes: [{ pitch: 65, step: 0, length: 16 }], key: { tonic: 'C', mode: 'major' } });
  assert.equal(dissonant.suggestions[0].symbol, 'F');
  assert.ok(dissonant.suggestions.findIndex(s => s.symbol === 'C') > 2, 'a held F pushes the tonic chord down the list');
  const replaced = suggest({ step: 0, notes: [{ id: 'x', pitch: 65, step: 0, length: 16 }], chords: [{ ...chord('F', 0), noteIds: ['x'] }], key: { tonic: 'C', mode: 'major' } });
  assert.equal(replaced.suggestions[0].symbol, 'C');
});

test('every suggested symbol is a supported chord and progressions fill eight bars', () => {
  for (const mode of ['major', 'minor']) for (const tonic of ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']) {
    const result = suggest({ limit: 12, key: { tonic, mode } });
    assert.equal(result.suggestions.length, mode === 'major' ? 12 : 12);
    for (const s of result.suggestions) assert.ok(chordPitches(s.symbol), `${s.symbol} must be supported`);
    for (const s of result.suggestions) assert.ok(Math.max(...chordPitches(s.symbol)) <= 84);
    assert.equal(result.progressions.length, 4);
    for (const p of result.progressions) {
      assert.equal(p.chords.length, 8);
      assert.deepEqual(p.chords.map(c => c.step), [0, 16, 32, 48, 64, 80, 96, 112]);
      for (const c of p.chords) assert.ok(chordPitches(c.symbol));
    }
  }
  assert.deepEqual(suggest({ key: { tonic: 'F', mode: 'major' } }).progressions[0].symbols, ['F', 'C', 'Dm', 'Bb']);
  assert.deepEqual(suggest({ key: { tonic: 'A', mode: 'minor' } }).progressions[1].symbols, ['Am', 'Dm', 'F', 'E']);
  assert.equal(romanOf('E7', 9, 'minor'), 'V7'); assert.equal(romanOf('E', 9, 'minor'), 'V'); assert.equal(romanOf('Bbmaj7', 0, 'major'), null);
  assert.equal(romanOf('Bdim', 0, 'major'), 'vii°'); assert.equal(romanOf('Bm7b5', 0, 'major'), 'vii°7'); assert.equal(romanOf('Bb', 5, 'major'), 'IV');
});

test('progression tips explain monotony, cadences, missing functions and well-known patterns', () => {
  const bars = symbols => symbols.map((symbol, i) => chord(symbol, i * 16));
  const tipsFor = (symbols, extra = {}) => suggest({ chords: bars(symbols), key: { tonic: 'C', mode: 'major' }, ...extra }).tips;
  const texts = tips => tips.map(t => t.text).join('\n');
  assert.match(texts(suggest({}).tips), /코드가 아직 없어요/);
  const mono = tipsFor(['C', 'C', 'C', 'C', 'C', 'C', 'C', 'C']);
  assert.equal(mono[0].level, 'warn'); assert.match(mono[0].text, /단조로울 수 있어요/);
  const pop = tipsFor(['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F']);
  assert.ok(pop.some(t => t.level === 'good' && /I–V–vi–IV/.test(t.text)));
  assert.ok(pop.some(t => /마지막 코드 F/.test(t.text)), 'ending on IV is called out');
  assert.ok(pop.some(t => /모두 3화음/.test(t.text)));
  const closed = tipsFor(['C', 'F', 'G7', 'C', 'Dm7', 'G7', 'Cmaj7', 'C']);
  assert.ok(closed.some(t => /ii–V–I/.test(t.text)) && closed.some(t => /마침 느낌이 분명/.test(t.text)));
  assert.ok(!closed.some(t => /모두 3화음/.test(t.text)));
  const half = tipsFor(['C', 'F', 'C', 'F', 'C', 'F', 'C', 'G']);
  assert.ok(half.some(t => /반종지/.test(t.text)) && half.some(t => /두 코드만|세 번 이상/.test(t.text)) === false || half.some(t => /반종지/.test(t.text)));
  const noV = tipsFor(['C', 'F', 'Am', 'F', 'C', 'F', 'Am', 'C']);
  assert.ok(noV.some(t => /딸림화음/.test(t.text)));
  const foreign = tipsFor(['C', 'Eb', 'F', 'C', 'C', 'F', 'G', 'C']);
  assert.ok(foreign.some(t => /Eb는 C 장조 밖/.test(t.text)));
  const retro = tipsFor(['C', 'G', 'F', 'C', 'C', 'G', 'F', 'C']);
  assert.ok(retro.some(t => /V 다음에 IV/.test(t.text)));
  const gap = tipsFor(['C', 'G']);
  assert.ok(gap.some(t => /마지막 마디까지/.test(t.text)));
  const clash = tipsFor(['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'C'], { notes: [{ pitch: 61, step: 0, length: 4 }, { pitch: 63, step: 16, length: 4 }] });
  assert.ok(clash.some(t => t.level === 'warn' && /2군데/.test(t.text)));
  const minor = progressionTips(parseSuggestRequest({ chords: bars(['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'G']) }), { tonic: 9, mode: 'minor' });
  assert.ok(minor.some(t => /i–VI–III–VII/.test(t.text)));
  for (const t of [...pop, ...closed, ...minor]) assert.ok(['good', 'info', 'warn'].includes(t.level));
  assert.ok(pop.length <= 6);
  const response = suggest({ chords: bars(['Dm7', 'G7', 'C']) });
  assert.deepEqual(response.analysis.romans.map(r => r.roman), ['ii7', 'V7', 'I']);
});

test('rejects malformed suggestion requests', () => {
  for (const invalid of [
    null, [], { step: 128 }, { step: 120, length: 16 }, { limit: 0 }, { notes: 'x' }, { notes: [{ pitch: 60, step: 0, length: 0 }] },
    { chords: [{ symbol: 'H7', step: 0, length: 4 }] }, { chords: [{ symbol: 'C', step: 0, length: 4, noteIds: [1] }] },
    { key: { tonic: 'H', mode: 'major' } }, { key: { tonic: 'C', mode: 'dorian' } },
  ]) assert.throws(() => parseSuggestRequest(invalid), /./, JSON.stringify(invalid));
  const parsed = parseSuggestRequest({ step: 120 });
  assert.equal(parsed.length, 8); assert.equal(parsed.limit, 6);
});
