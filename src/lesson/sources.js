import { buildIndex, contentWordCount, isStopword, scoreChunks, termGroups, tokenize } from '../../shared/text.js';

export const PLAN_CHAR_BUDGET = 60000;

const MIN_SHARED = 2;
const MIN_COVERAGE = 0.3;
const RELATED_COVERAGE = 0.45;
const SECOND_SOURCE_RATIO = 0.8;
const SUBSTANTIVE_WORDS = 6;

export const selectPlanChunks = (chunks, budget = PLAN_CHAR_BUDGET) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
  if (total <= budget) return chunks;

  const averageLength = total / chunks.length;
  const count = Math.max(1, Math.floor(budget / averageLength));
  const stride = chunks.length / count;
  const picked = [];
  let used = 0;
  for (let i = 0; i < count; i += 1) {
    const chunk = chunks[Math.floor(i * stride)];
    if (used + chunk.text.length > budget) break;
    picked.push(chunk);
    used += chunk.text.length;
  }
  return picked;
};

export const chunksById = (chunks, ids) => {
  const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
};

const indexCache = new WeakMap();

const indexFor = (chunks) => {
  if (!indexCache.has(chunks)) indexCache.set(chunks, buildIndex(chunks));
  return indexCache.get(chunks);
};

const strongEnough = (match, coverage) => match.shared >= MIN_SHARED && match.coverage >= coverage;

export const findMessageSources = (text, chunks, { candidateIds = null, stepIds = [] } = {}) => {
  const candidates = candidateIds ? new Set(candidateIds) : null;
  const ranked = scoreChunks(text, indexFor(chunks)).sort((a, b) => b.score - a.score);
  const eligible = ranked.filter((match) => !candidates || candidates.has(match.chunk.id));

  const best = eligible[0];
  if (best && strongEnough(best, MIN_COVERAGE)) {
    const second = eligible[1];
    const sources = [{ chunkId: best.chunk.id, kind: 'based', score: best.coverage }];
    if (second && strongEnough(second, MIN_COVERAGE) && second.score >= best.score * SECOND_SOURCE_RATIO) {
      sources.push({ chunkId: second.chunk.id, kind: 'based', score: second.coverage });
    }
    return sources;
  }

  const related = ranked.find((match) => strongEnough(match, RELATED_COVERAGE));
  if (related) return [{ chunkId: related.chunk.id, kind: 'related', score: related.coverage }];

  if (contentWordCount(text) >= SUBSTANTIVE_WORDS && stepIds.length > 0) {
    return stepIds.slice(0, 1).map((chunkId) => ({ chunkId, kind: 'step', score: 0 }));
  }
  return [];
};

export const highlightPassage = (passage, message) => {
  const terms = new Set(termGroups(message).flat());
  return passage.split(/([\p{L}\p{N}]+)/u).map((part, index) => {
    const token = tokenize(part)[0];
    return {
      key: index,
      text: part,
      hit: index % 2 === 1 && Boolean(token) && !isStopword(token) && termGroups(part).some((group) => group.some((form) => terms.has(form))),
    };
  });
};
