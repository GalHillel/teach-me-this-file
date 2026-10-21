import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ExtractionError } from './errors.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const MAX_PDF_PAGES = 300;
const MIN_PAGE_CHARS = 25;

const pageText = (items) =>
  items
    .map((item) => (item.hasEOL ? `${item.str}\n` : item.str))
    .join('')
    .replace(/[ \t]+\n/g, '\n');

const openPdf = async (data) => {
  const task = pdfjs.getDocument({
    data,
    cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/cmaps/`,
    cMapPacked: true,
    isEvalSupported: false,
  });
  try {
    return { task, pdf: await task.promise };
  } catch (error) {
    await task.destroy();
    if (error?.name === 'PasswordException') {
      throw new ExtractionError('password', 'This PDF is password protected. Remove the password and upload it again.');
    }
    throw new ExtractionError('corrupt', 'This PDF could not be opened. It may be damaged or not a real PDF.');
  }
};

export const extractPdf = async (file, onProgress) => {
  const { task, pdf } = await openPdf(new Uint8Array(await file.arrayBuffer()));
  const totalPages = pdf.numPages;
  const pageCount = Math.min(totalPages, MAX_PDF_PAGES);
  const sections = [];
  const emptyPages = [];

  try {
    for (let number = 1; number <= pageCount; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = pageText(content.items);
      if (text.replace(/\s/g, '').length < MIN_PAGE_CHARS) {
        emptyPages.push(number);
      } else {
        sections.push({ label: `Page ${number}`, text });
      }
      page.cleanup();
      onProgress?.(number / pageCount);
    }
  } finally {
    await task.destroy();
  }

  const warnings = [];
  if (totalPages > MAX_PDF_PAGES) {
    warnings.push(`Only the first ${MAX_PDF_PAGES} of ${totalPages} pages were read.`);
  }
  if (sections.length === 0) {
    throw new ExtractionError(
      'scanned',
      'No readable text was found. The PDF looks like scanned images, and this app does not run OCR. Try a PDF with selectable text, or paste the content into a .txt file.',
    );
  }
  if (emptyPages.length > 0) {
    warnings.push(
      `${emptyPages.length} page${emptyPages.length > 1 ? 's' : ''} had no selectable text (scanned images or diagrams) and ${emptyPages.length > 1 ? 'were' : 'was'} skipped: ${formatPages(emptyPages)}.`,
    );
  }

  return { sections, pageCount: totalPages, warnings };
};

const formatPages = (pages) => {
  const shown = pages.slice(0, 8).join(', ');
  return pages.length > 8 ? `${shown} and ${pages.length - 8} more` : shown;
};
