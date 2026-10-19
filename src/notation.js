const naturals = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function spellingPitch(spelling) {
  if (typeof spelling !== 'string') return null;
  const match = /^([A-G])(bb|##|b|#)?([3-6])$/.exec(spelling);
  if (!match) return null;
  return (Number(match[3]) + 1) * 12 + naturals[match[1]] + (match[2]?.startsWith('b') ? -match[2].length : match[2]?.length || 0);
}
export function chordPitches(symbol) {
  if (typeof symbol !== 'string' || ['Cbdim7', 'B#aug'].includes(symbol)) return null;
  const m = /^([A-G])([#b]?)(maj7|m7b5|dim7|sus2|sus4|m7|m6|dim|aug|7|6|m)?$/.exec(symbol);
  if (!m) return null;
  const intervals = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], dim: [0, 3, 6], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7], '6': [0, 4, 7, 9], m6: [0, 3, 7, 9] };
  let root = 60 + naturals[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  if (root < 60) root += 12;
  return intervals[m[3] || ''].map(interval => root + interval);
}
