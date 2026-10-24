import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Markdown from '../src/components/Markdown.jsx';
import { findMessageSources } from '../src/lesson/sources.js';
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
