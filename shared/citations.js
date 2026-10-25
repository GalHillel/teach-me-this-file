const CITATION = /\[\s*(c\d{1,4}(?:\s*[,;]\s*c\d{1,4})*)\s*\]/gi;
const QUOTE = /(?<=^|[\s([:,—–-])["“”„«]([^"“”„«»\n]{1,300})["“”»](?=$|[\s.,;:!?)\]—–-])/gu;
const CITED_AFTER = /^[\s.,;:]{0,3}\[\s*c\d/i;
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;
const MIN_QUOTE_WORDS = 4;

const normalize = (text) =>
  String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const splitIds = (list) => list.split(/[,;]/).map((id) => id.trim().toLowerCase());

export const mapCitations = (text, render) =>
  String(text ?? '')
    .split(CODE)
    .map((part, index) => (index % 2 ? part : part.replace(CITATION, (whole, list) => render(splitIds(list)))))
    .join('');

export const citedIds = (text) => {
  const ids = [];
  mapCitations(text, (list) => {
    ids.push(...list);
    return '';
  });
  return [...new Set(ids)];
};

export const quotedSpans = (text) => {
  const source = String(text ?? '');
  return [...source.matchAll(QUOTE)]
    .filter((match) => CITED_AFTER.test(source.slice(match.index + match[0].length)))
    .map((match) => match[1].trim())
    .filter((span) => normalize(span).split(' ').length >= MIN_QUOTE_WORDS);
};

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
  mapCitations(text, (list) => {
    const ids = list.filter((id) => keep(id));
    return ids.length ? `[${ids.join(', ')}]` : '';
  });
