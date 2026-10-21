import { detectDirection } from '../../shared/text.js';
import { buildChunks } from './chunk.js';
import { ExtractionError, unreadableRatio } from './errors.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENT_CHARS = 600_000;

export const FILE_TYPES = {
  pdf: { label: 'PDF', extensions: ['pdf'], load: () => import('./pdf.js').then((module) => module.extractPdf) },
  docx: { label: 'Word', extensions: ['docx'], load: () => import('./docx.js').then((module) => module.extractDocx) },
  txt: { label: 'Text', extensions: ['txt', 'md', 'markdown'], load: () => import('./text.js').then((module) => module.extractText) },
};

export const ACCEPTED_EXTENSIONS = Object.values(FILE_TYPES).flatMap((type) => type.extensions.map((ext) => `.${ext}`));

export const detectFileType = (fileName) => {
  const extension = fileName.toLowerCase().split('.').pop();
  return Object.keys(FILE_TYPES).find((type) => FILE_TYPES[type].extensions.includes(extension)) ?? null;
};

export const validateFile = (file) => {
  const type = detectFileType(file.name);
  if (!type) {
    throw new ExtractionError('unsupported', `"${file.name}" is not supported. Upload a PDF, Word (.docx) or text (.txt, .md) file.`);
  }
  if (file.size === 0) {
    throw new ExtractionError('empty', 'This file is empty.');
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new ExtractionError('too_large', `This file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)}.`);
  }
  return type;
};

const limitChunks = (chunks) => {
  let total = 0;
  const kept = [];
  for (const chunk of chunks) {
    if (total + chunk.text.length > MAX_DOCUMENT_CHARS) break;
    total += chunk.text.length;
    kept.push(chunk);
  }
  return { kept, total };
};

export const prepareDocument = ({ file, type, sections, pageCount, warnings }) => {
  const chunks = buildChunks(sections);
  if (chunks.length === 0) {
    throw new ExtractionError('empty', 'No readable text was found in this file.');
  }

  const { kept, total } = limitChunks(chunks);
  const notes = [...warnings];
  if (kept.length < chunks.length) {
    notes.push(`The document is very long. Only the first ${kept.length} of ${chunks.length} passages are used (up to "${kept.at(-1).label}").`);
  }

  const sample = kept.slice(0, 20).map((chunk) => chunk.text).join('\n');
  if (unreadableRatio(sample) > 0.05) {
    notes.push('Part of the text uses a font that could not be decoded, so some characters may be missing or wrong.');
  }

  return {
    name: file.name,
    type,
    size: file.size,
    pageCount,
    chunks: kept,
    charCount: total,
    direction: detectDirection(sample),
    warnings: notes,
  };
};

export const extractDocument = async (file, onProgress) => {
  const type = validateFile(file);
  const extract = await FILE_TYPES[type].load();
  const { sections, pageCount, warnings } = await extract(file, onProgress);
  return prepareDocument({ file, type, sections, pageCount, warnings });
};

export const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};
