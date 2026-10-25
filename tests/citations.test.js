import { describe, expect, it } from 'vitest';
import { citedIds, mapCitations, quotedSpans, stripCitations, verifyCitations } from '../shared/citations.js';

const chunks = [
  { id: 'c1', label: 'Lines 1–3', text: 'Leaves take in carbon dioxide from the air through tiny openings called stomata.' },
  { id: 'c2', label: 'Lines 5–7', text: 'Chlorophyll absorbs mostly red and blue light and reflects green light.' },
];

describe('citation checks', () => {
  it('reads single and grouped passage ids', () => {
    expect(citedIds('Plants breathe in through stomata [c1]. Light matters [C2, c1].')).toEqual(['c1', 'c2']);
    expect(citedIds('No citation here, only [brackets] and [c] alone.')).toEqual([]);
  });

  it('keeps only ids the tutor was given and reports the rest', () => {
    const result = verifyCitations('Stomata let air in [c1]. Roots drink water [c7].', chunks);
    expect(result.cited).toEqual(['c1']);
    expect(result.invalid).toEqual(['c7']);
  });

  it('checks that a cited quote really appears in the file, ignoring case and punctuation', () => {
    const result = verifyCitations('The file says "Chlorophyll absorbs mostly red and blue light" [c2], and “the moon is made of green cheese” [c1].', chunks);
    expect(result.quotes).toEqual([
      { text: 'Chlorophyll absorbs mostly red and blue light', chunkId: 'c2' },
      { text: 'the moon is made of green cheese', chunkId: null },
    ]);
  });

  it('does not check quotes without a passage id, such as the student\'s own words', () => {
    expect(verifyCitations('You wrote "plants eat soil through roots", which is a common idea.', chunks).quotes).toEqual([]);
  });

  it('ignores short quoted words, which are emphasis rather than quotes', () => {
    expect(quotedSpans('A plant can "cook" its own food, the "kitchen" being the leaf.')).toEqual([]);
  });

  it('does not mistake quote marks inside Hebrew abbreviations for quotes', () => {
    expect(quotedSpans('צה"ל ונאס"א הם ארגונים גדולים עם הרבה עובדים בארה"ב ובישראל.')).toEqual([]);
  });

  it('finds Hebrew quotes in the Hebrew file', () => {
    const hebrew = [{ id: 'c3', label: 'שורות 1–2', text: 'המים מתאדים והופכים לאדי מים, גז שעולה לאוויר.' }];
    expect(verifyCitations('בקובץ כתוב "המים מתאדים והופכים לאדי מים" [c3].', hebrew).quotes[0].chunkId).toBe('c3');
  });

  it('strips citation markers that should not be shown', () => {
    expect(stripCitations('Air goes in [c1]. Water goes up [c9, c2].', (id) => id !== 'c9')).toBe('Air goes in [c1]. Water goes up [c2].');
    expect(stripCitations('Made up [c9].', () => false)).toBe('Made up .');
  });

  it('leaves code spans alone', () => {
    const text = 'Use `arr[c1]` here [c1].\n\n```\nx = y[c2]\n```';
    expect(citedIds(text)).toEqual(['c1']);
    expect(mapCitations(text, (ids) => `<${ids.join('|')}>`)).toBe('Use `arr[c1]` here <c1>.\n\n```\nx = y[c2]\n```');
  });
});
