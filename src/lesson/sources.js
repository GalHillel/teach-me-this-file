import { rankChunks, tokenize } from '../../shared/text.js';

export const PLAN_CHAR_BUDGET = 60000;

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

export const findMessageSources = (text, chunks, stepSourceIds) => {
  const matches = rankChunks(text, chunks, { limit: 2 });
  if (matches.length > 0) {
    return matches.map((match) => ({ chunkId: match.chunk.id, kind: 'match' }));
  }
  return stepSourceIds.slice(0, 2).map((chunkId) => ({ chunkId, kind: 'step' }));
};

export const highlightPassage = (passage, message) => {
  const terms = new Set(tokenize(message));
  return passage.split(/([\p{L}\p{N}]+)/u).map((part, index) => ({
    key: index,
    text: part,
    hit: index % 2 === 1 && part.length >= 4 && terms.has(tokenize(part)[0]),
  }));
};
