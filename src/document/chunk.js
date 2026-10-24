import { headingOf } from './structure.js';

const MAX_CHUNK_CHARS = 1100;
const TARGET_CHUNK_CHARS = 700;

export const normalizeText = (text) =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00AD/g, '')
    .replace(/[\t\f\v\u00A0]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const splitLongLine = (line) => {
  if (line.length <= MAX_CHUNK_CHARS) return [line];
  const sentences = line.match(/[^.!?\u3002\u061F]+[.!?\u3002\u061F]*\s*/gu) ?? [line];
  const parts = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > MAX_CHUNK_CHARS) {
      parts.push(current.trim());
      current = '';
    }
    current += sentence;
    while (current.length > MAX_CHUNK_CHARS) {
      parts.push(current.slice(0, MAX_CHUNK_CHARS).trim());
      current = current.slice(MAX_CHUNK_CHARS);
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
};

export const buildChunks = (sections) => {
  const chunks = [];
  let section = null;
  const push = (text, label, chunkSection) => {
    if (!text.trim()) return;
    const chunk = { id: `c${chunks.length + 1}`, label, text: text.trim() };
    if (chunkSection) chunk.section = chunkSection.slice(0, 120);
    chunks.push(chunk);
  };

  for (const source of sections) {
    const headings = source.headings?.length ? new Set(source.headings) : null;
    const lines = normalizeText(source.text).split('\n').flatMap(splitLongLine);
    let current = '';
    let currentSection = section;
    for (const line of lines) {
      const heading = headingOf(line, headings);
      if (heading) {
        push(current, source.label, currentSection);
        current = '';
        section = heading;
        currentSection = heading;
      }
      if (current && current.length + line.length > MAX_CHUNK_CHARS) {
        push(current, source.label, currentSection);
        current = '';
        currentSection = section;
      }
      current += current ? `\n${line}` : line;
      if (current.length >= TARGET_CHUNK_CHARS && line === '') {
        push(current, source.label, currentSection);
        current = '';
        currentSection = section;
      }
    }
    push(current, source.label, currentSection);
  }

  return chunks;
};
