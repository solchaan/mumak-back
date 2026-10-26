import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSuggestRequest } from '../src/harmony.js';
import { reviewSketch } from '../src/review.js';
const note = (pitch, step, length = 4) => ({ id: `note-${step}-${pitch}`, pitch, step, length });
const chord = (symbol, step = 0, length = 16) => ({ symbol, step, length });
const review = (notes, chords = [chord('C')], rest = {}) => reviewSketch(parseSuggestRequest({ notes, chords, key: { tonic: 'C', mode: 'major' }, ...rest }));

test('distinguishes resolved tension and passing notes from sustained non-chord tones', () => {
  const resolved = review([note(65, 0), note(64, 4)]);
  assert.ok(resolved.good.some(x => x.code === 'resolution'));
  assert.equal(resolved.consider.some(x => x.code === 'tension'), false);
  const passing = review([note(60, 0, 1), note(62, 1, 1), note(64, 2, 2)]);
  assert.ok(passing.good.some(x => x.code === 'passing'));
  const tension = review([note(65, 0, 8)]);
  assert.equal(tension.consider.find(x => x.code === 'tension').step, 0);
  assert.equal(tension.alternatives[0].edit.pitch, 64);
  assert.equal(tension.alternatives[0].edit.fromPitch, 65);
  assert.ok(!Object.hasOwn(tension, 'score'));
});

test('includes sustained notes across chord changes and excludes uncovered time', () => {
  const result = review([note(64, 0, 16)], [chord('C', 0, 16), chord('Dm', 8, 8)]);
  assert.equal(result.consider.find(x => x.code === 'tension').step, 8);
  const gap = review([note(65, 20, 4)]);
  assert.equal(gap.consider.some(x => x.code === 'tension'), false);
  assert.ok(gap.limitations.some(x => x.includes('비어 있는')));
});

test('polyphonic input skips inferred melodic lines but still checks harmony', () => {
  const result = review([note(60, 0, 8), note(77, 0, 8)]);
  assert.ok(result.limitations.some(x => x.includes('겹쳐')));
  assert.equal(result.consider.some(x => x.code === 'leap'), false);
  assert.ok(result.consider.some(x => x.code === 'tension'));
});

test('detects large leaps, contrary step recovery, and transposed motifs', () => {
  assert.ok(review([note(60, 0), note(72, 4)]).consider.some(x => x.code === 'leap'));
  const recovered = review([note(60, 0), note(72, 4), note(71, 8)]);
  assert.ok(recovered.good.some(x => x.code === 'leap-return'));
  assert.equal(recovered.consider.some(x => x.code === 'leap'), false);
  const motif = review([note(60, 0), note(62, 4), note(64, 8), note(65, 16), note(67, 20), note(69, 24)], []);
  assert.ok(motif.good.some(x => x.code === 'motif' && x.step === 16));
});

test('reports cadences only for adjacent chords and offers a repeated-chord experiment', () => {
  assert.ok(review([], [chord('G7'), chord('C', 16)]).good.some(x => x.code === 'cadence'));
  assert.equal(review([], [chord('G7', 0, 4), chord('C', 16)]).good.some(x => x.code === 'cadence'), false);
  const repeated = review([], [chord('C'), chord('C', 16), chord('C', 32)]);
  assert.ok(repeated.alternatives.some(x => x.edit.kind === 'chord' && x.edit.symbol !== 'C'));
});

test('empty input, large bounded input and missing IDs produce safe non-mutating reports', () => {
  const input = parseSuggestRequest({}); const before = JSON.stringify(input);
  const empty = reviewSketch(input);
  assert.equal(empty.alternatives.length, 0); assert.equal(empty.good.length, 0);
  assert.ok(empty.limitations.some(x => x.includes('조성'))); assert.equal(JSON.stringify(input), before);
  const dense = review(Array.from({ length: 512 }, (_, i) => note(60 + i % 25, i % 128, 1)), Array.from({ length: 128 }, (_, step) => chord('C', step, 1)));
  assert.ok(dense.good.length <= 8 && dense.consider.length <= 8 && dense.alternatives.length <= 4);
  assert.equal(review([{ pitch: 65, step: 0, length: 8 }]).alternatives.length, 0);
});
