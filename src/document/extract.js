import { detectDirection } from '../../shared/text.js';
import { buildChunks } from './chunk.js';
import { ExtractionError, unreadableRatio } from './errors.js';
import { checkSignature, dropDuplicateChunks } from './structure.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_DOCUMENT_CHARS = 600_000;
export const SHORT_DOCUMENT_CHARS = 400;

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
    throw new ExtractionError('unsupported', `"${file.name}" is not supported. Upload a PDF, Word (.docx) or text (.txt, .md) file.`, { name: file.name });
  }
  if (file.size === 0) {
    throw new ExtractionError('empty', 'This file is empty.');
  }
  if (file.size > MAX_FILE_BYTES) {
    const params = { size: formatBytes(file.size), limit: formatBytes(MAX_FILE_BYTES) };
    throw new ExtractionError('too_large', `This file is ${params.size}. The limit is ${params.limit}.`, params);
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

export const prepareDocument = ({ file, type, sections, pageCount, warnings, removedLines = 0 }) => {
  const { chunks, duplicates } = dropDuplicateChunks(buildChunks(sections));
  if (chunks.length === 0) {
    throw new ExtractionError('empty', 'No readable text was found in this file.');
  }

  const { kept, total } = limitChunks(chunks);
  const notes = [...warnings];
  if (kept.length < chunks.length) {
    notes.push({ code: 'long', params: { kept: kept.length, total: chunks.length, label: kept.at(-1).label } });
  }

  const sample = kept.slice(0, 20).map((chunk) => chunk.text).join('\n');
  if (unreadableRatio(sample) > 0.05) {
    notes.push({ code: 'font', params: {} });
  }
  if (total < SHORT_DOCUMENT_CHARS) {
    notes.push({ code: 'short', params: { count: total } });
  }

  return {
    name: file.name,
    type,
    size: file.size,
    pageCount,
    chunks: kept,
    charCount: total,
    direction: detectDirection(sample),
    sectionCount: new Set(kept.map((chunk) => chunk.section).filter(Boolean)).size,
    cleanup: { removedLines, duplicates },
    warnings: notes,
  };
};

const SIGNATURE_ERRORS = {
  pdf: 'This file is named .pdf but is not a PDF.',
  docx: 'This file is named .docx but is not a Word document. Old .doc files are not supported.',
  txt: 'This file is named as text but contains binary data.',
};

export const verifySignature = async (file, type) => {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  if (!checkSignature(head, type)) throw new ExtractionError(type === 'txt' ? 'unsupported' : 'corrupt', SIGNATURE_ERRORS[type], { name: file.name });
};

export const extractDocument = async (file, onProgress) => {
  const type = validateFile(file);
  await verifySignature(file, type);
  const extract = await FILE_TYPES[type].load();
  const { sections, pageCount, warnings, removedLines } = await extract(file, onProgress);
  return prepareDocument({ file, type, sections, pageCount, warnings, removedLines });
};

export const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};
