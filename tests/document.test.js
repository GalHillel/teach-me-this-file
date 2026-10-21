import { describe, expect, it } from 'vitest';
import { buildChunks, normalizeText } from '../src/document/chunk.js';
import { decodeText, textToSections } from '../src/document/text.js';
import { MAX_FILE_BYTES, detectFileType, prepareDocument, validateFile } from '../src/document/extract.js';

const fakeFile = (name, size) => ({ name, size });

describe('normalizeText', () => {
  it('joins hyphenated line breaks and collapses spaces', () => {
    expect(normalizeText('photo-\nsynthesis   is\r\n\n\n\nfun')).toBe('photosynthesis is\n\nfun');
  });
});

describe('buildChunks', () => {
  it('keeps the section label on every chunk', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} explains one more idea about cells.`).join('\n');
    const chunks = buildChunks([{ label: 'Page 4', text: long }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.label === 'Page 4')).toBe(true);
    expect(chunks.every((chunk) => chunk.text.length <= 1100)).toBe(true);
    expect(chunks.map((chunk) => chunk.id)).toEqual(chunks.map((_, i) => `c${i + 1}`));
  });

  it('splits a single huge line without losing text', () => {
    const line = 'word '.repeat(700).trim();
    const chunks = buildChunks([{ label: 'Page 1', text: line }]);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.map((chunk) => chunk.text).join(' ').split(' ').length).toBe(700);
  });

  it('skips empty sections', () => {
    expect(buildChunks([{ label: 'Page 1', text: '  \n\n ' }])).toEqual([]);
  });
});

describe('text files', () => {
  it('decodes UTF-8 Hebrew', () => {
    const bytes = new TextEncoder().encode('שלום כיתה ז');
    expect(decodeText(bytes.buffer)).toBe('שלום כיתה ז');
  });

  it('falls back to windows-1255 for legacy Hebrew files', () => {
    const legacy = new Uint8Array([0xf9, 0xec, 0xe5, 0xed]);
    expect(decodeText(legacy.buffer)).toBe('שלום');
  });

  it('labels sections with real line numbers', () => {
    const text = Array.from({ length: 45 }, (_, i) => `line ${i + 1}`).join('\n');
    const sections = textToSections(text);
    expect(sections.map((section) => section.label)).toEqual(['Lines 1–40', 'Lines 41–45']);
  });
});

describe('file validation', () => {
  it('detects supported types by extension', () => {
    expect(detectFileType('Lesson.PDF')).toBe('pdf');
    expect(detectFileType('notes.md')).toBe('txt');
    expect(detectFileType('slides.pptx')).toBe(null);
  });

  it('rejects unsupported, empty and oversized files with a clear code', () => {
    expect(() => validateFile(fakeFile('a.pptx', 10))).toThrow(expect.objectContaining({ code: 'unsupported' }));
    expect(() => validateFile(fakeFile('a.pdf', 0))).toThrow(expect.objectContaining({ code: 'empty' }));
    expect(() => validateFile(fakeFile('a.pdf', MAX_FILE_BYTES + 1))).toThrow(expect.objectContaining({ code: 'too_large' }));
  });

  it('prepares a document with chunks, direction and warnings', () => {
    const document = prepareDocument({
      file: fakeFile('bio.txt', 120),
      type: 'txt',
      sections: [{ label: 'Lines 1–2', text: 'התא הוא יחידת החיים הבסיסית.\nלכל תא יש קרום.' }],
      pageCount: null,
      warnings: [],
    });
    expect(document.direction).toBe('rtl');
    expect(document.chunks).toHaveLength(1);
    expect(document.chunks[0].label).toBe('Lines 1–2');
  });

  it('refuses documents with no text', () => {
    expect(() => prepareDocument({ file: fakeFile('a.txt', 3), type: 'txt', sections: [], pageCount: null, warnings: [] }))
      .toThrow(expect.objectContaining({ code: 'empty' }));
  });
});
