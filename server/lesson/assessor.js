import { AppError } from '../errors.js';
import { ASSESS_SYSTEM, buildAssessPrompt } from './prompts.js';

const VERDICTS = new Set(['correct', 'partial', 'incorrect', 'question', 'off_topic']);

const note = (value) => (typeof value === 'string' ? value.trim().slice(0, 300) : '');

export const assessAnswer = async ({ provider, plan, progress, tutorQuestion, studentMessage, sources, signal }) => {
  const step = plan.steps[progress.currentStep];
  try {
    const raw = await provider.generateJson({
      task: 'assessment',
      system: ASSESS_SYSTEM,
      prompt: buildAssessPrompt({ plan, step, tutorQuestion, studentMessage, sources }),
      signal,
    });
    const verdict = String(raw?.verdict ?? '').toLowerCase().trim();
    return {
      verdict: VERDICTS.has(verdict) ? verdict : 'unclear',
      understood: note(raw?.understood),
      missing: note(raw?.missing),
      misconception: note(raw?.misconception),
    };
  } catch (error) {
    if (error instanceof AppError && error.code === 'bad_response') {
      return { verdict: 'unclear', understood: '', missing: '', misconception: '' };
    }
    throw error;
  }
};
