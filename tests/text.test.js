import { describe, expect, it } from 'vitest';
import { detectDirection, directionForLanguage, rankChunks, tokenize } from '../shared/text.js';

const chunks = [
  { id: 'c1', label: 'Page 1', text: 'Photosynthesis lets plants turn sunlight, water and carbon dioxide into glucose and oxygen.' },
  { id: 'c2', label: 'Page 2', text: 'Chlorophyll inside the chloroplasts absorbs red and blue light and reflects green light.' },
  { id: 'c3', label: 'Page 3', text: 'Cellular respiration releases the energy stored in glucose so cells can use it.' },
];

describe('direction', () => {
  it('detects right-to-left text', () => {
    expect(detectDirection('הפוטוסינתזה היא תהליך שבו צמחים מייצרים סוכר')).toBe('rtl');
    expect(detectDirection('Photosynthesis is a process')).toBe('ltr');
    expect(detectDirection('12345')).toBe('ltr');
  });

  it('maps language codes to a direction', () => {
    expect(directionForLanguage('he')).toBe('rtl');
    expect(directionForLanguage('ar-EG')).toBe('rtl');
    expect(directionForLanguage('fr')).toBe('ltr');
    expect(directionForLanguage(undefined)).toBe('ltr');
  });
});

describe('tokenize', () => {
  it('lowercases, strips diacritics and short words', () => {
    expect(tokenize('Élève, the ÉCOLE is big')).toEqual(['eleve', 'the', 'ecole', 'big']);
  });

  it('strips Hebrew vowel marks', () => {
    expect(tokenize('שָׁלוֹם עוֹלָם')).toEqual(['שלום', 'עולם']);
  });
});

describe('rankChunks', () => {
  it('finds the passage a tutor message is based on', () => {
    const matches = rankChunks('Chlorophyll absorbs red and blue light, which is why leaves look green.', chunks);
    expect(matches[0].chunk.id).toBe('c2');
  });

  it('returns nothing when the text is unrelated', () => {
    expect(rankChunks('The French revolution started in 1789 in Paris.', chunks)).toEqual([]);
  });

  it('returns nothing for empty input', () => {
    expect(rankChunks('', chunks)).toEqual([]);
    expect(rankChunks('glucose', [])).toEqual([]);
  });
});
