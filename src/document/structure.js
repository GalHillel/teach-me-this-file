const EDGE_LINES = 2;
const MAX_HEADING_LENGTH = 90;
const HEADING_SIZE_RATIO = 1.2;
const MARKDOWN_HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/;

const PAGE_MARKER = /(?:page|pg\.?|p\.|seite|página|pagina|עמוד|עמ['׳]|страница|صفحة)\s*\d+(?:\s*(?:of|\/|מתוך|de|von|di|из|من)\s*\d+)?/giu;
const EDGE_NUMBER = /^\d+\s*[|·•\-–—]\s*|\s*[|·•\-–—]\s*\d+$/gu;

const lineKey = (text) => {
  const clean = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^[^\p{L}\p{N}]*\d+(?:\s*(?:\/|of)\s*\d+)?[^\p{L}\p{N}]*$/u.test(clean)) return '#';
  return clean.replace(PAGE_MARKER, '#').replace(EDGE_NUMBER, ' #');
};

export const pageLines = (items) => {
  const lines = [];
  let text = '';
  let size = 0;
  for (const item of items) {
    text += item.str;
    if (item.str.trim()) size = Math.max(size, Math.abs(item.height || item.transform?.[3] || 0));
    if (item.hasEOL) {
      lines.push({ text: text.replace(/[ \t]+$/, ''), size });
      text = '';
      size = 0;
    }
  }
  if (text) lines.push({ text: text.replace(/[ \t]+$/, ''), size });
  return lines;
};

export const stripRepeatedLines = (pages) => {
  if (pages.length < 3) return { pages, removed: 0 };
  const threshold = Math.max(3, Math.ceil(pages.length / 2));
  const counts = new Map();
  for (const page of pages) {
    const keys = new Set();
    const content = page.lines.filter((line) => line.text.trim());
    for (const line of [...content.slice(0, EDGE_LINES), ...content.slice(-EDGE_LINES)]) keys.add(lineKey(line.text));
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeated = new Set([...counts].filter(([key, count]) => key && count >= threshold).map(([key]) => key));
  if (!repeated.size) return { pages, removed: 0 };

  let removed = 0;
  const cleaned = pages.map((page) => {
    const content = page.lines.filter((line) => line.text.trim());
    const edges = new Set([...content.slice(0, EDGE_LINES), ...content.slice(-EDGE_LINES)]);
    return {
      ...page,
      lines: page.lines.filter((line) => {
        const drop = edges.has(line) && repeated.has(lineKey(line.text));
        if (drop) removed += 1;
        return !drop;
      }),
    };
  });
  return { pages: cleaned, removed };
};

const looksLikeHeadingText = (text) => {
  const clean = text.trim();
  return clean.length >= 2 && clean.length <= MAX_HEADING_LENGTH && !/[.,;:!?]$/.test(clean) && /\p{L}/u.test(clean);
};

export const markPdfHeadings = (pages) => {
  const sizes = pages.flatMap((page) => page.lines.flatMap((line) => Array(Math.max(1, line.text.length)).fill(line.size || 0)));
  const sorted = sizes.filter(Boolean).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (!median) return pages;
  return pages.map((page) => ({
    ...page,
    lines: page.lines.map((line) => ({
      ...line,
      heading: line.size >= median * HEADING_SIZE_RATIO && looksLikeHeadingText(line.text),
    })),
  }));
};

export const pagesToSections = (pages) =>
  pages.map((page) => ({
    label: page.label,
    text: page.lines.map((line) => line.text).join('\n'),
    headings: page.lines.filter((line) => line.heading).map((line) => line.text.trim()),
  }));

export const headingOf = (line, headings) => {
  const markdown = line.match(MARKDOWN_HEADING);
  if (markdown) return markdown[1].trim();
  return headings?.has(line.trim()) ? line.trim() : null;
};

const fingerprint = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export const dropDuplicateChunks = (chunks) => {
  const seen = new Set();
  let duplicates = 0;
  const kept = chunks.filter((chunk) => {
    const key = fingerprint(chunk.text);
    if (key.length < 40) return true;
    if (seen.has(key)) {
      duplicates += 1;
      return false;
    }
    seen.add(key);
    return true;
  });
  return { chunks: kept.map((chunk, index) => ({ ...chunk, id: `c${index + 1}` })), duplicates };
};

const startsWith = (bytes, signature) => signature.every((value, index) => bytes[index] === value);

export const checkSignature = (bytes, type) => {
  if (type === 'pdf') {
    const head = new TextDecoder('latin1').decode(bytes.slice(0, 1024));
    return head.includes('%PDF-');
  }
  if (type === 'docx') return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  if (type === 'txt') {
    const sample = bytes.slice(0, 4096);
    const zeros = sample.filter((value) => value === 0).length;
    return zeros === 0 || startsWith(sample, [0xff, 0xfe]) || startsWith(sample, [0xfe, 0xff]);
  }
  return true;
};
