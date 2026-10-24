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

  it('warns about very short documents with a code the UI can translate', () => {
    const document = prepareDocument({
      file: fakeFile('short.txt', 40),
      type: 'txt',
      sections: [{ label: 'Lines 1–1', text: 'Water boils at 100 degrees.' }],
      pageCount: null,
      warnings: [{ code: 'images', params: {} }],
    });
    expect(document.warnings).toEqual([{ code: 'images', params: {} }, { code: 'short', params: { count: 27 } }]);
  });

  it('refuses documents with no text', () => {
    expect(() => prepareDocument({ file: fakeFile('a.txt', 3), type: 'txt', sections: [], pageCount: null, warnings: [] }))
      .toThrow(expect.objectContaining({ code: 'empty' }));
  });
});

describe('document structure', async () => {
  const { checkSignature, dropDuplicateChunks, markPdfHeadings, pageLines, pagesToSections, stripRepeatedLines } = await import('../src/document/structure.js');

  const page = (number, body) => ({
    label: `Page ${number}`,
    lines: [
      { text: 'Biology 7 - Chapter 3', size: 9 },
      ...body.map((text) => ({ text, size: 11 })),
      { text: `Page ${number} of 12`, size: 9 },
    ],
  });

  it('removes running headers and footers that repeat on most pages, ignoring page numbers', () => {
    const pages = [page(1, ['Cells are alive.']), page(2, ['Cells divide.']), page(3, ['Cells use energy.']), page(4, ['Cells have DNA.'])];
    const { pages: cleaned, removed } = stripRepeatedLines(pages);
    expect(removed).toBe(8);
    expect(cleaned.map((item) => item.lines.map((line) => line.text))).toEqual([['Cells are alive.'], ['Cells divide.'], ['Cells use energy.'], ['Cells have DNA.']]);
  });

  it('keeps edge lines that do not repeat and leaves short documents alone', () => {
    const pages = [page(1, ['A']), page(2, ['B'])];
    expect(stripRepeatedLines(pages).removed).toBe(0);
    const mixed = [
      { label: 'Page 1', lines: [{ text: 'Introduction' }, { text: 'Text one.' }] },
      { label: 'Page 2', lines: [{ text: 'Methods' }, { text: 'Text two.' }] },
      { label: 'Page 3', lines: [{ text: 'Results' }, { text: 'Text three.' }] },
    ];
    expect(stripRepeatedLines(mixed).removed).toBe(0);
  });

  it('marks larger, short lines without final punctuation as PDF headings', () => {
    const pages = markPdfHeadings([{ label: 'Page 1', lines: [
      { text: 'The water cycle', size: 16 },
      { text: 'Water evaporates when the sun heats it, and it rises as vapour into the air above.', size: 11 },
      { text: 'Big text that ends with a full stop.', size: 16 },
      { text: 'Condensation', size: 14 },
    ] }]);
    expect(pages[0].lines.map((line) => line.heading)).toEqual([true, false, false, true]);
    expect(pagesToSections(pages)[0].headings).toEqual(['The water cycle', 'Condensation']);
  });

  it('starts a new passage at each heading and keeps the section across pages', () => {
    const chunks = buildChunks([
      { label: 'Page 1', text: 'The water cycle\nWater evaporates.\nCondensation\nVapour cools into droplets.', headings: ['The water cycle', 'Condensation'] },
      { label: 'Page 2', text: 'Clouds form from the droplets.' },
    ]);
    expect(chunks.map((chunk) => [chunk.label, chunk.section, chunk.text.split('\n')[0]])).toEqual([
      ['Page 1', 'The water cycle', 'The water cycle'],
      ['Page 1', 'Condensation', 'Condensation'],
      ['Page 2', 'Condensation', 'Clouds form from the droplets.'],
    ]);
  });

  it('reads Markdown headings in text files', () => {
    const chunks = buildChunks([{ label: 'Lines 1–4', text: '# Plants\nPlants make food.\n## Roots\nRoots take in water.' }]);
    expect(chunks.map((chunk) => chunk.section)).toEqual(['Plants', 'Roots']);
  });

  it('drops passages that repeat word for word and renumbers the rest', () => {
    const repeated = 'This page intentionally left blank for printing purposes in the original book.';
    const { chunks, duplicates } = dropDuplicateChunks([
      { id: 'c1', label: 'Page 1', text: repeated },
      { id: 'c2', label: 'Page 2', text: 'Real content about cells and energy in living things.' },
      { id: 'c3', label: 'Page 3', text: repeated },
      { id: 'c4', label: 'Page 4', text: 'Short' },
      { id: 'c5', label: 'Page 5', text: 'Short' },
    ]);
    expect(duplicates).toBe(1);
    expect(chunks.map((chunk) => `${chunk.id}:${chunk.label}`)).toEqual(['c1:Page 1', 'c2:Page 2', 'c3:Page 4', 'c4:Page 5']);
  });

  it('checks file signatures so a renamed file gets a clear error', () => {
    const bytes = (text) => new TextEncoder().encode(text);
    expect(checkSignature(bytes('%PDF-1.7\n...'), 'pdf')).toBe(true);
    expect(checkSignature(bytes('<html>not a pdf</html>'), 'pdf')).toBe(false);
    expect(checkSignature(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]), 'docx')).toBe(true);
    expect(checkSignature(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), 'docx')).toBe(false);
    expect(checkSignature(bytes('plain text'), 'txt')).toBe(true);
    expect(checkSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13]), 'txt')).toBe(false);
  });

  it('decodes UTF-16 text files with a byte order mark', () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0xe9, 0x05, 0xdc, 0x05]);
    expect(decodeText(utf16.buffer)).toBe('של');
  });

  it('groups PDF text items into lines with their font size', () => {
    expect(pageLines([
      { str: 'Title', height: 18, hasEOL: true },
      { str: 'Body ', height: 11 },
      { str: 'text', height: 11, hasEOL: true },
    ])).toEqual([{ text: 'Title', size: 18 }, { text: 'Body text', size: 11 }]);
  });
});
