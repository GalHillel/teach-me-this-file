import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Markdown from '../src/components/Markdown.jsx';
import { findMessageSources, findRelatedPassages, readableText, searchPassages } from '../src/lesson/sources.js';
import { scoreSourceMatching } from '../eval/sources.js';

const chunks = [
  { id: 'c1', label: 'Page 1', text: 'Mitochondria release energy from glucose through cellular respiration.' },
  { id: 'c2', label: 'Page 2', text: 'Chloroplasts capture sunlight and make glucose during photosynthesis.' },
];

describe('source matching golden set', () => {
  const result = scoreSourceMatching();

  it('never shows a source for messages that are not based on the file', () => {
    expect(result.falseMatches).toBe(0);
  });

  it('keeps the top source right and avoids extra sources', () => {
    expect(result.top1).toBeGreaterThanOrEqual(0.9);
    expect(result.shown).toBeGreaterThanOrEqual(0.95);
    expect(result.extraSources).toBeLessThanOrEqual(2);
  });
});

describe('findMessageSources', () => {
  it('marks a message as based on a passage only when enough key words match', () => {
    expect(findMessageSources('Chloroplasts capture sunlight to make glucose.', chunks)).toEqual([{ chunkId: 'c2', kind: 'based', score: expect.any(Number) }]);
  });

  it('prefers the passages of the current and next step', () => {
    const message = 'Glucose is made by chloroplasts and used by mitochondria.';
    expect(findMessageSources(message, chunks, { candidateIds: ['c1'] })[0].chunkId).toBe('c1');
  });

  it('labels a strong match outside the current step as related', () => {
    const message = 'Chloroplasts capture sunlight and make glucose.';
    expect(findMessageSources(message, chunks, { candidateIds: ['c1'] })).toEqual([{ chunkId: 'c2', kind: 'related', score: expect.any(Number) }]);
  });

  it('falls back to the step passage only for a substantive message', () => {
    const french = 'Les mitochondries libèrent de l\'énergie à partir du sucre dans nos cellules vivantes.';
    expect(findMessageSources(french, chunks, { stepIds: ['c1'] })).toEqual([{ chunkId: 'c1', kind: 'step', score: 0 }]);
    expect(findMessageSources('Great job!', chunks, { stepIds: ['c1'] })).toEqual([]);
    expect(findMessageSources('Unrelated text here.', chunks)).toEqual([]);
  });

  it('ignores praise and filler words when matching', () => {
    expect(findMessageSources('Great, exactly right, well done, very good answer!', chunks, { candidateIds: ['c1', 'c2'] })).toEqual([]);
  });
});

describe('findRelatedPassages', () => {
  const history = [
    { id: 'h1', label: 'Page 1', text: 'The storming of the Bastille happened on 14 July 1789, when crowds looked for gunpowder.' },
    { id: 'h2', label: 'Page 2', text: 'During the Terror, Robespierre led the Committee of Public Safety and many were executed.' },
    { id: 'h3', label: 'Page 3', text: 'Napoleon Bonaparte took power in 1799 and crowned himself emperor in 1804.' },
  ];

  it('finds a passage for a short question with one key word', () => {
    expect(findRelatedPassages('Who was Robespierre?', history).map((chunk) => chunk.id)).toEqual(['h2']);
  });

  it('abstains when the question uses words the document never mentions', () => {
    expect(findRelatedPassages('What happened in the Russian Revolution?', history)).toEqual([]);
    expect(findRelatedPassages('How do black holes form?', history)).toEqual([]);
    expect(findRelatedPassages('', history)).toEqual([]);
  });

  it('leaves out passages the tutor already has', () => {
    expect(findRelatedPassages('When did Napoleon become emperor?', history, { exclude: ['h3'] })).toEqual([]);
  });

  it('meets the retrieval golden set targets for questions', async () => {
    const { evaluateRetrieval } = await import('../eval/retrieval.js');
    const result = evaluateRetrieval();
    expect(result.question.unanswerableWithSourceShown).toBe(0);
    expect(result.question.shownRecall).toBeGreaterThanOrEqual(0.75);
    expect(result.question.shownPrecision).toBeGreaterThanOrEqual(0.8);
    expect(result.tutor.unanswerableWithSourceShown).toBe(0);
    expect(result.tutor.shownPrecision).toBeGreaterThanOrEqual(0.95);
  });
});

describe('document search', () => {
  const chunks = [
    { id: 'c1', label: 'Lines 1–3', text: '## Roots\n\nRoots take in water from the soil.' },
    { id: 'c2', label: 'Lines 5–6', text: '## Leaves\nLeaves use light to make sugar.' },
  ];

  it('finds the passage that mentions the search words', () => {
    expect(searchPassages('light sugar', chunks).map((chunk) => chunk.id)).toEqual(['c2']);
  });

  it('shows Markdown headings without the hash marks and keeps blank lines', () => {
    expect(readableText(chunks[0].text)).toBe('Roots\n\nRoots take in water from the soil.');
    expect(readableText('Use C# daily.\n#hashtag')).toBe('Use C# daily.\n#hashtag');
  });
});

describe('Markdown rendering of model output', () => {
  const render = (text) => renderToStaticMarkup(createElement(Markdown, null, text));

  it('drops javascript: links and raw HTML', () => {
    const html = render('[click](javascript:alert(1)) <img src=x onerror=alert(1)> <script>alert(1)</script>');
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/<img|<script/i);
    expect(html).toContain('&lt;script&gt;');
  });

  it('keeps normal links safe to open', () => {
    expect(render('[docs](https://example.com)')).toContain('rel="noreferrer noopener"');
  });
});
