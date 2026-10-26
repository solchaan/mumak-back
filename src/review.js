import { chordPitches } from './notation.js';
import { estimateKey, romanOf, suggestChords } from './harmony.js';

const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = pitch => names[pitch % 12] + (Math.floor(pitch / 12) - 1);
const location = step => `${Math.floor(step / 16) + 1}마디 ${Math.floor(step % 16 / 4) + 1}박${step % 4 ? ` + ${step % 4}/16` : ''}`;
const tones = chord => new Set(chordPitches(chord.symbol).map(p => p % 12));

// These observations describe a tonal sketch, not its artistic quality. No audio
// or external model is used. Later chord onsets supersede earlier held symbols.
export function reviewSketch(request) {
  const legacy = new Set(request.chords.flatMap(c => c.noteIds));
  const notes = request.notes.filter(n => !legacy.has(n.id)).sort((a, b) => a.step - b.step || a.pitch - b.pitch);
  const chords = request.chords.map((c, i, all) => ({ ...c, length: Math.min(c.length, (all[i + 1]?.step ?? 128) - c.step) })).filter(c => c.length > 0);
  const inferred = request.key || estimateKey(notes, chords);
  const key = { tonic: names[inferred.tonic], mode: inferred.mode, estimated: !request.key };
  const good = [], consider = [], alternatives = [], limitations = [];
  const add = (list, code, step, title, detail, noteId) => {
    if (list.length < 8 && !list.some(item => item.code === code && item.step === step)) list.push({ code, step, location: location(step), title, detail, ...(noteId ? { noteId } : {}) });
  };
  const active = step => chords.find(c => c.step <= step && step < c.step + c.length);
  const overlaps = notes.some((n, i) => i > 0 && notes.slice(0, i).some(p => p.step + p.length > n.step));
  if (!notes.length) limitations.push('멜로디가 없어 코드 진행만 확인했습니다.');
  if (!chords.length) limitations.push('코드가 없어 멜로디와 화음의 관계는 판단하지 않았습니다.');
  if (overlaps) limitations.push('겹쳐 울리는 음표가 있어 단선율 도약·경과음·동기 분석은 생략했습니다. 화음과 각 음의 관계는 확인합니다.');
  if (!request.key) limitations.push('전체 스케치에서 조성을 추정했습니다. 조표를 지정하면 의도한 조성으로 다시 평가할 수 있습니다.');
  limitations.push('장르·연주 표현·녹음 오디오·보이싱은 평가하지 않습니다. 긴장이나 반복은 의도한 표현일 수 있습니다.');
  const pitchAlternative = (note, pitch, reason) => {
    if (!note.id || pitch < 60 || pitch > 84 || pitch === note.pitch || alternatives.length >= 4) return;
    if (alternatives.some(a => a.edit.kind === 'note' && a.edit.noteId === note.id)) return;
    alternatives.push({ title: `${noteName(note.pitch)} → ${noteName(pitch)}`, step: note.step, location: location(note.step), reason,
      edit: { kind: 'note', noteId: note.id, step: note.step, length: note.length, fromPitch: note.pitch, pitch } });
  };
  let covered = 0, matched = 0;
  for (const [i, n] of notes.entries()) {
    // Include held notes spanning a chord change, not just note attacks.
    for (const c of chords) {
      const start = Math.max(n.step, c.step), end = Math.min(n.step + n.length, c.step + c.length);
      if (end <= start) continue;
      const pcs = tones(c); covered += end - start;
      if (pcs.has(n.pitch % 12)) { matched += end - start; continue; }
      const next = notes[i + 1], previous = notes[i - 1];
      const resolves = !overlaps && next && next.step === n.step + n.length && next.step < c.step + c.length && Math.abs(next.pitch - n.pitch) <= 2 && next.pitch !== n.pitch && pcs.has(next.pitch % 12);
      const passing = resolves && previous && previous.step + previous.length === n.step && previous.step >= c.step && pcs.has(previous.pitch % 12) && Math.abs(n.pitch - previous.pitch) <= 2 && (n.pitch - previous.pitch) * (next.pitch - n.pitch) > 0 && n.step % 4 !== 0 && n.length <= 2;
      if (resolves) {
        add(good, passing ? 'passing' : 'resolution', start, passing ? '짧은 경과음으로 연결됩니다' : '긴장이 이웃한 구성음으로 풀립니다', `${c.symbol} 위의 ${noteName(n.pitch)}가 ${noteName(next.pitch)}로 이어집니다. ${passing ? '구성음 사이를 순차적으로 잇는 흐름입니다.' : '비화성음을 사용하고도 다음 음에서 안정감을 만들 수 있는 흐름입니다.'}`, n.id);
      } else if (end - start >= 4 || start % 8 === 0) {
        add(consider, 'tension', start, '길거나 강한 위치의 비화성음', `${c.symbol}와 ${noteName(n.pitch)}가 ${end - start}칸 겹칩니다. 가까운 다음 음으로 해소되는 흐름은 확인되지 않았습니다. 텐션이나 의도한 색채라면 유지해도 좋습니다.`, n.id);
        const choices = Array.from({ length: 25 }, (_, j) => j + 60).filter(p => pcs.has(p % 12)).sort((a, b) => Math.abs(a - n.pitch) - Math.abs(b - n.pitch) || a - b);
        pitchAlternative(n, choices[0], `${location(start)}의 ${c.symbol} 구성음으로 바꿔 안정감의 차이를 들어보세요. 원래 음의 긴장이 더 좋으면 유지하세요.`);
      }
    }
  }
  if (covered && matched / covered >= .7) add(good, 'chord-support', notes[0].step, '코드 구성음이 멜로디를 받쳐 줍니다', `코드와 겹치는 음표 길이 중 ${Math.round(matched / covered * 100)}%가 구성음입니다. 곡의 점수가 아닌 음표 길이 기준의 관찰입니다.`);
  if (notes.some(n => {
    const intervals = chords.map(c => [Math.max(c.step, n.step), Math.min(c.step + c.length, n.step + n.length)]).filter(([a,b]) => b > a);
    return intervals.reduce((sum, [a,b]) => sum + b - a, 0) < n.length;
  })) limitations.push('코드가 비어 있는 구간의 음은 화음 관계 분석에서 제외했습니다.');

  if (!overlaps) {
    for (let i = 1; i < notes.length; i++) {
      const a = notes[i - 1], b = notes[i], next = notes[i + 1];
      if (b.step - (a.step + a.length) > 4) continue;
      const leap = b.pitch - a.pitch;
      if (Math.abs(leap) < 7) continue;
      if (next && next.step === b.step + b.length && (next.pitch - b.pitch) * leap < 0 && Math.abs(next.pitch - b.pitch) <= 2) {
        add(good, 'leap-return', b.step, '도약 뒤에 반대 방향으로 이어집니다', `${noteName(a.pitch)} → ${noteName(b.pitch)} 뒤에 ${noteName(next.pitch)}로 순차 진행합니다.`, b.id);
      } else {
        add(consider, 'leap', b.step, '큰 도약의 느낌을 확인해 보세요', `${noteName(a.pitch)} → ${noteName(b.pitch)}로 ${Math.abs(leap)}반음 이동합니다. 강조에는 좋지만 부드러운 선율을 원한다면 음역을 좁혀 비교해 보세요.`, b.id);
        const shifted = b.pitch - Math.sign(leap) * 12;
        if (Math.abs(shifted - a.pitch) < Math.abs(leap)) pitchAlternative(b, shifted, '같은 음이름을 다른 옥타브에 놓아 도약 폭을 줄입니다. 강조감이 줄어드는지도 비교하세요.');
      }
    }
    for (let bar = 1; bar < 8; bar++) {
      const a = notes.filter(n => n.step >= (bar - 1) * 16 && n.step + n.length <= bar * 16);
      const b = notes.filter(n => n.step >= bar * 16 && n.step + n.length <= (bar + 1) * 16);
      const pattern = list => list.map(n => [n.step % 16, n.length, n.pitch - list[0].pitch].join(':')).join(',');
      if (a.length >= 3 && a.length === b.length && pattern(a) === pattern(b)) add(good, 'motif', bar * 16, '이전 마디의 동기가 이어집니다', `${bar}·${bar + 1}마디의 리듬과 음정 윤곽이 같습니다. 반복 또는 이조된 반복이 기억할 만한 연결을 만듭니다.`);
    }
  }
  if (notes.length >= 4) {
    const low = Math.min(...notes.map(n => n.pitch)), high = Math.max(...notes.map(n => n.pitch));
    if (high - low > 12) add(consider, 'range', notes.find(n => n.pitch === high).step, '멜로디 음역이 한 옥타브를 넘습니다', `${noteName(low)}–${noteName(high)}, ${high - low}반음입니다. 보컬용이라면 실제 부를 사람의 음역과 비교하세요. 악기용이라면 의도한 범위일 수 있습니다.`);
    if (!overlaps && notes.length >= 8 && notes.every((n, i) => !i || n.step === notes[i-1].step + notes[i-1].length)) add(consider, 'breath', notes[0].step, '음표 사이에 쉼이 없습니다', '보컬 프레이즈라면 중간에 숨 쉴 틈을 두어 비교해 보세요. 악기나 지속적인 패턴에는 자연스러운 선택입니다.');
  }
  for (let i = 1; i < chords.length; i++) {
    const prev = chords[i - 1], c = chords[i];
    const from = romanOf(prev.symbol, inferred.tonic, inferred.mode)?.replace(/7$/, '');
    const to = romanOf(c.symbol, inferred.tonic, inferred.mode)?.replace(/7$/, '');
    if (prev.step + prev.length === c.step && from === 'V' && ['I','i'].includes(to)) add(good, 'cadence', c.step, '딸림화음에서 으뜸화음으로 연결됩니다', `${prev.symbol} → ${c.symbol}는 조성 안에서 긴장을 풀어 주는 연결입니다. 실제 종지 느낌은 멜로디와 박자 위치에 따라 달라집니다.`);
  }
  if (chords.length >= 3 && new Set(chords.map(c => c.symbol)).size === 1) {
    const c = chords[Math.floor(chords.length / 2)];
    add(consider, 'repeated-chord', c.step, '한 코드가 반복됩니다', `${c.symbol}가 ${chords.length}번 이어집니다. 그루브를 유지하는 선택일 수 있습니다. 전개가 필요하다면 중간 코드만 바꿔 비교하세요.`);
    const option = suggestChords({ ...request, notes, chords, step: c.step, length: c.length, limit: 12 }).suggestions.find(s => s.symbol !== c.symbol);
    if (option && alternatives.length < 4) alternatives.push({ title: `${c.symbol} → ${option.symbol}`, step: c.step, location: location(c.step), reason: `해당 위치의 멜로디와 앞뒤 코드를 고려한 비교 후보입니다. ${option.reason}. 더 좋은 코드라는 판정은 아닙니다.`, edit: { kind: 'chord', step: c.step, fromSymbol: c.symbol, symbol: option.symbol } });
  }
  const last = chords.at(-1);
  if (last && last.step + last.length === 128 && !['I','i'].includes(romanOf(last.symbol, inferred.tonic, inferred.mode)?.replace(/7$/, ''))) add(consider, 'open-ending', last.step, '마지막이 으뜸화음 이외의 코드입니다', `${last.symbol}로 끝납니다. 반복을 이어갈지 곡을 마칠지에 따라 열린 느낌이 어울리는지 들어보세요.`);
  return { key, good, consider, alternatives, limitations, summary: `${notes.length}개 음표와 ${chords.length}개 코드의 관계를 확인했습니다. 총점이나 정답을 매기지 않습니다.` };
}
