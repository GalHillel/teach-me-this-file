const RTL_LETTER = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\uFB1D-\uFDFF\uFE70-\uFEFF]/gu;
const LETTER = /\p{L}/gu;
const RTL_LANGUAGES = new Set(['he', 'iw', 'ar', 'fa', 'ur', 'yi', 'ps', 'dv', 'ckb', 'syr']);

export const detectDirection = (text) => {
  const letters = text.match(LETTER)?.length ?? 0;
  if (letters === 0) return 'ltr';
  const rtlLetters = text.match(RTL_LETTER)?.length ?? 0;
  return rtlLetters / letters > 0.3 ? 'rtl' : 'ltr';
};

export const directionForLanguage = (languageCode) => {
  const base = String(languageCode || '').toLowerCase().split(/[-_]/)[0];
  return RTL_LANGUAGES.has(base) ? 'rtl' : 'ltr';
};

export const tokenize = (text) =>
  String(text || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]{3,}/gu) ?? [];

const documentFrequencies = (chunks) => {
  const frequencies = new Map();
  for (const chunk of chunks) {
    for (const term of new Set(tokenize(chunk.text))) {
      frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    }
  }
  return frequencies;
};

export const rankChunks = (query, chunks, { limit = 2, minScore = 0.15, minShared = 3 } = {}) => {
  const queryTerms = new Set(tokenize(query));
  if (queryTerms.size === 0 || chunks.length === 0) return [];

  const frequencies = documentFrequencies(chunks);
  const idf = (term) => Math.log(1 + chunks.length / frequencies.get(term));
  const knownTerms = [...queryTerms].filter((term) => frequencies.has(term));
  const maxWeight = knownTerms.reduce((sum, term) => sum + idf(term), 0);
  if (maxWeight === 0) return [];

  return chunks
    .map((chunk) => {
      const chunkTerms = new Set(tokenize(chunk.text));
      const shared = knownTerms.filter((term) => chunkTerms.has(term));
      const weight = shared.reduce((sum, term) => sum + idf(term), 0);
      return { chunk, score: weight / maxWeight, shared: shared.length };
    })
    .filter((match) => match.shared >= minShared && match.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
};
