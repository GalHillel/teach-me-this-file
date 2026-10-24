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

const numberedLines = (source) => {
  const lines = [];
  source.text.split(/\r\n?|\n/).forEach((raw, index) => {
    const text = normalizeText(raw);
    if (!text && (!lines.length || lines.at(-1).text === '')) return;
    for (const part of splitLongLine(text)) lines.push({ text: part, line: source.firstLine + index });
  });
  return lines;
};

const sourceLines = (source) =>
  Number.isInteger(source.firstLine)
    ? numberedLines(source)
    : normalizeText(source.text).split('\n').flatMap(splitLongLine).map((text) => ({ text, line: null }));

const labelFor = (source, lines) => {
  const numbers = lines.filter((entry) => entry.text && entry.line !== null).map((entry) => entry.line);
  return numbers.length ? `Lines ${numbers[0]}–${numbers.at(-1)}` : source.label;
};

export const buildChunks = (sections) => {
  const chunks = [];
  let section = null;
  const push = (lines, source, chunkSection) => {
    const text = lines.map((entry) => entry.text).join('\n').trim();
    if (!text) return;
    const chunk = { id: `c${chunks.length + 1}`, label: labelFor(source, lines), text };
    if (chunkSection) chunk.section = chunkSection.slice(0, 120);
    chunks.push(chunk);
  };

  for (const source of sections) {
    const headings = source.headings?.length ? new Set(source.headings.map(normalizeText)) : null;
    let current = [];
    let length = 0;
    let currentSection = section;
    const flush = () => {
      push(current, source, currentSection);
      current = [];
      length = 0;
      currentSection = section;
    };
    for (const entry of sourceLines(source)) {
      const heading = headingOf(entry.text, headings);
      if (heading) {
        section = heading;
        flush();
      }
      if (length && length + entry.text.length > MAX_CHUNK_CHARS) flush();
      current.push(entry);
      length += entry.text.length + (current.length > 1 ? 1 : 0);
      if (length >= TARGET_CHUNK_CHARS && entry.text === '') flush();
    }
    flush();
  }

  return chunks;
};
