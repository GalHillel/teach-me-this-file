import { ExtractionError, unreadableRatio } from './errors.js';

const LINES_PER_SECTION = 40;

export const decodeText = (buffer) => {
  const head = new Uint8Array(buffer.slice(0, 2));
  if (head[0] === 0xff && head[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer).replace(/^\uFEFF/, '');
  if (head[0] === 0xfe && head[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer).replace(/^\uFEFF/, '');
  const utf8 = new TextDecoder('utf-8').decode(buffer).replace(/^\uFEFF/, '');
  if (unreadableRatio(utf8) < 0.01) return utf8;
  return new TextDecoder('windows-1255').decode(buffer);
};

export const textToSections = (text) => {
  const lines = text.split(/\r\n?|\n/);
  const sections = [];
  for (let start = 0; start < lines.length; start += LINES_PER_SECTION) {
    const slice = lines.slice(start, start + LINES_PER_SECTION);
    if (slice.join('').trim()) {
      sections.push({ label: `Lines ${start + 1}–${start + slice.length}`, firstLine: start + 1, text: slice.join('\n') });
    }
  }
  return sections;
};

export const extractText = async (file) => {
  const text = decodeText(await file.arrayBuffer());
  const sections = textToSections(text);
  if (sections.length === 0) {
    throw new ExtractionError('empty', 'This file is empty.');
  }
  return { sections, pageCount: null, warnings: [] };
};
