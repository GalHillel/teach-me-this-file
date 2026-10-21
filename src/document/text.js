import { ExtractionError, unreadableRatio } from './errors.js';

const LINES_PER_SECTION = 40;

export const decodeText = (buffer) => {
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
      sections.push({ label: `Lines ${start + 1}–${start + slice.length}`, text: slice.join('\n') });
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
