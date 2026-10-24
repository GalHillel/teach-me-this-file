import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ExtractionError } from './errors.js';
import { markPdfHeadings, pageLines, pagesToSections, stripRepeatedLines } from './structure.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const MAX_PDF_PAGES = 300;
const MIN_PAGE_CHARS = 25;


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
  const pages = [];
  const emptyPages = [];

  try {
    for (let number = 1; number <= pageCount; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const lines = pageLines(content.items);
      if (lines.map((line) => line.text).join('').replace(/\s/g, '').length < MIN_PAGE_CHARS) {
        emptyPages.push(number);
      } else {
        pages.push({ label: `Page ${number}`, lines });
      }
      page.cleanup();
      onProgress?.(number / pageCount);
    }
  } finally {
    await task.destroy();
  }

  const { pages: cleaned, removed } = stripRepeatedLines(pages);
  const sections = pagesToSections(markPdfHeadings(cleaned));
  const warnings = [];
  if (totalPages > MAX_PDF_PAGES) {
    warnings.push({ code: 'pages_limit', params: { max: MAX_PDF_PAGES, total: totalPages } });
  }
  if (sections.length === 0) {
    throw new ExtractionError(
      'scanned',
      'No readable text was found. The PDF looks like scanned images, and this app does not run OCR. Try a PDF with selectable text, or paste the content into a .txt file.',
    );
  }
  if (emptyPages.length > 0) {
    warnings.push({ code: 'empty_pages', params: { count: emptyPages.length, pages: formatPages(emptyPages) } });
  }

  return { sections, pageCount: totalPages, warnings, removedLines: removed };
};

const formatPages = (pages) => {
  const shown = pages.slice(0, 8).join(', ');
  return pages.length > 8 ? `${shown} (+${pages.length - 8})` : shown;
};
