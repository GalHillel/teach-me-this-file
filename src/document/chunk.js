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
  const push = (text, label) => {
    if (text.trim()) chunks.push({ id: `c${chunks.length + 1}`, label, text: text.trim() });
  };

  for (const section of sections) {
    const lines = normalizeText(section.text).split('\n').flatMap(splitLongLine);
    let current = '';
    for (const line of lines) {
      if (current && current.length + line.length > MAX_CHUNK_CHARS) {
        push(current, section.label);
        current = '';
      }
      current += current ? `\n${line}` : line;
      if (current.length >= TARGET_CHUNK_CHARS && line === '') {
        push(current, section.label);
        current = '';
      }
    }
    push(current, section.label);
  }

  return chunks;
};
