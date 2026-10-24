import mammoth from 'mammoth';
import { ExtractionError } from './errors.js';

const cellText = (cell) => cell.textContent.replace(/\s+/g, ' ').trim();

const blockText = (element) => {
  const tag = element.tagName.toLowerCase();
  if (tag === 'table') {
    return [...element.querySelectorAll('tr')]
      .map((row) => [...row.children].map(cellText).join(' | '))
      .join('\n');
  }
  if (tag === 'ul' || tag === 'ol') {
    return [...element.querySelectorAll('li')].map((item) => `• ${cellText(item)}`).join('\n');
  }
  return element.textContent.trim();
};

export const htmlToSections = (html) => {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  const sections = [];
  let current = { label: 'Beginning', text: '' };

  for (const element of body.children) {
    if (/^h[1-6]$/i.test(element.tagName)) {
      if (current.text.trim()) sections.push(current);
      const heading = cellText(element).slice(0, 80);
      current = { label: heading ? `Section: ${heading}` : 'Section', text: `${heading}\n` };
      continue;
    }
    const text = blockText(element);
    if (text) current.text += `${text}\n\n`;
  }
  if (current.text.trim()) sections.push(current);

  return { sections, hasImages: body.querySelector('img') !== null };
};

export const extractDocx = async (file) => {
  let result;
  try {
    result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  } catch {
    throw new ExtractionError('corrupt', 'This Word file could not be opened. It may be damaged, or an old .doc file saved with a .docx name.');
  }

  const { sections, hasImages } = htmlToSections(result.value);
  if (sections.length === 0) {
    throw new ExtractionError('empty', 'This Word file has no readable text.');
  }

  const warnings = hasImages ? [{ code: 'images', params: {} }] : [];
  return { sections, pageCount: null, warnings };
};
