const CITATION = /\[\s*(c\d{1,4}(?:\s*[,;]\s*c\d{1,4})*)\s*\]/gi;
const QUOTE = /(?<=^|[\s([:,\u2014\u2013-])["\u201C\u201D\u201E\u00AB]([^"\u201C\u201D\u201E\u00AB\u00BB\n]{1,300})["\u201C\u201D\u00BB](?=$|[\s.,;:!?)\]\u2014\u2013-])/gu;
const MIN_QUOTE_WORDS = 4;

const normalize = (text) =>
  String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const citedIds = (text) => {
  const ids = [];
  for (const match of String(text ?? '').matchAll(CITATION)) {
    for (const id of match[1].split(/[,;]/)) ids.push(id.trim().toLowerCase());
  }
  return [...new Set(ids)];
};

export const quotedSpans = (text) =>
  [...String(text ?? '').matchAll(QUOTE)]
    .map((match) => match[1].trim())
    .filter((span) => normalize(span).split(' ').length >= MIN_QUOTE_WORDS);

export const verifyCitations = (reply, chunks) => {
  const byId = new Map(chunks.map((chunk) => [chunk.id.toLowerCase(), chunk]));
  const ids = citedIds(reply);
  const cited = ids.filter((id) => byId.has(id));
  const invalid = ids.filter((id) => !byId.has(id));
  const normalized = chunks.map((chunk) => ({ id: chunk.id, text: normalize(chunk.text) }));
  const quotes = quotedSpans(reply).map((span) => {
    const needle = normalize(span);
    const preferred = normalized.filter((chunk) => cited.includes(chunk.id.toLowerCase()));
    const found = [...preferred, ...normalized].find((chunk) => chunk.text.includes(needle));
    return { text: span.slice(0, 160), chunkId: found?.id ?? null };
  });
  return { cited, invalid, quotes };
};

export const stripCitations = (text, keep) =>
  String(text ?? '').replace(CITATION, (whole, list) => {
    const ids = list.split(/[,;]/).map((id) => id.trim().toLowerCase()).filter((id) => keep(id));
    return ids.length ? `[${ids.join(', ')}]` : '';
  });
