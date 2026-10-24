import { AppError } from '../errors.js';
import { ASSESS_SYSTEM, buildAssessPrompt } from './prompts.js';

const VERDICTS = new Set(['correct', 'partial', 'incorrect', 'question', 'off_topic']);
const CONFIDENCE = ['low', 'medium', 'high'];
const DEFAULT_COMPLETENESS = { correct: 1, partial: 0.5, incorrect: 0 };

const DONT_KNOW = /^\s*(i\s*(really\s*)?(do\s*n[o']?t|dunno)\s*know|idk|no\s*idea|not\s*sure|\?+|לא\s*יודע(ת)?|אין\s*לי\s*מושג|je\s*ne\s*sais\s*pas|aucune\s*id[eé]e|no\s*s[eé])\s*[.!?]*\s*$/iu;
const GRADER_INSTRUCTION = /(\b(system|grader|developer)\s*:|\bmark (this|it|my answer) (as )?(correct|right)\b|\bignore (all |the |your |previous )*(rules|instructions)\b)/i;

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const list = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => text(item, 120))
    .filter(Boolean)
    .slice(0, 5);

const simplify = (value) =>
  String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const lowerConfidence = (confidence) => CONFIDENCE[Math.max(0, CONFIDENCE.indexOf(confidence) - 1)];

export const unclearAssessment = () => ({
  verdict: 'unclear',
  completeness: 0,
  conceptsShown: [],
  conceptsMissing: [],
  misconception: '',
  evidence: '',
  confidence: 'low',
  checks: ['no_usable_grade'],
});

export const normalizeAssessment = (raw, studentMessage) => {
  const verdictText = String(raw?.verdict ?? '').toLowerCase().trim();
  if (!VERDICTS.has(verdictText)) return unclearAssessment();

  let verdict = verdictText;
  const checks = [];
  const reported = Number(raw?.completeness);
  const completeness = Number.isFinite(reported) ? Math.min(Math.max(reported, 0), 1) : DEFAULT_COMPLETENESS[verdict] ?? 0;
  let confidence = CONFIDENCE.includes(raw?.confidence) ? raw.confidence : 'medium';

  let evidence = text(raw?.evidence, 300);
  if (evidence && !simplify(studentMessage).includes(simplify(evidence))) {
    evidence = '';
    confidence = lowerConfidence(confidence);
    checks.push('evidence_not_in_answer');
  }

  if (verdict === 'correct' && completeness < 0.5) {
    verdict = 'partial';
    confidence = 'low';
    checks.push('correct_but_incomplete');
  }

  if ((verdict === 'correct' || verdict === 'partial') && DONT_KNOW.test(studentMessage)) {
    verdict = 'incorrect';
    checks.push('student_said_dont_know');
  }

  if (verdict === 'correct' && GRADER_INSTRUCTION.test(studentMessage)) {
    verdict = 'off_topic';
    checks.push('instruction_in_answer');
  }

  return {
    verdict,
    completeness,
    conceptsShown: list(raw?.conceptsShown),
    conceptsMissing: list(raw?.conceptsMissing),
    misconception: text(raw?.misconception, 200),
    evidence,
    confidence,
    checks,
  };
};

export const assessAnswer = async ({ provider, plan, progress, tutorQuestion, studentMessage, sources, signal, onMeta }) => {
  const step = plan.steps[progress.currentStep];
  try {
    const raw = await provider.generateJson({
      task: 'assessment',
      system: ASSESS_SYSTEM,
      prompt: buildAssessPrompt({ plan, step, tutorQuestion, studentMessage, sources }),
      signal,
      onMeta,
    });
    return normalizeAssessment(raw, studentMessage);
  } catch (error) {
    if (error instanceof AppError && error.code === 'bad_response') return unclearAssessment();
    throw error;
  }
};
