import { assessedStepIndex } from '../../shared/lesson.js';
import { AppError } from '../errors.js';
import { ASSESS_SYSTEM, buildAssessPrompt } from './prompts.js';

const VERDICTS = new Set(['correct', 'partial', 'incorrect', 'question', 'off_topic']);
const CONFIDENCE = ['low', 'medium', 'high'];
export const ISSUES = ['none', 'misread_question', 'hedged', 'no_knowledge', 'unjustified', 'copied'];
const ISSUE_VERDICTS = {
  misread_question: new Set(['partial', 'incorrect', 'off_topic']),
  hedged: new Set(['correct', 'partial']),
  no_knowledge: new Set(['incorrect']),
  unjustified: new Set(['correct', 'partial']),
  copied: new Set(['correct', 'partial']),
};
const COPY_MIN_WORDS = 6;
const COPY_SHARE = 0.7;
const COPY_SENTENCE_SHARE = 0.8;
const COPY_SCAN_WORDS = 120;
const DEFAULT_COMPLETENESS = { correct: 1, partial: 0.5, incorrect: 0 };

const DONT_KNOW = /^\s*(i\s*(really\s*)?(do\s*n[o']?t|dunno)\s*know|idk|no\s*idea|not\s*sure|\?+|לא\s*יודע(ת)?|אין\s*לי\s*מושג|je\s*ne\s*sais\s*pas|aucune\s*id[eé]e|no\s*s[eé])\s*[.!?]*\s*$/iu;
const HEDGE = /(^|[\s,.;!?])(maybe|perhaps|i think|i guess|i'm not sure|im not sure|not sure|probably|אולי|נראה לי|אני חושב|אני חושבת|לא בטוח|לא בטוחה|peut-être|peut etre|je crois|je pense|pas sûr|pas sure|quizás|creo que)([\s,.;!?]|$)/iu;
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

const longestRun = (words, text) => {
  let longest = 0;
  for (let start = 0; start < words.length && words.length - start > longest; start += 1) {
    let end = start + longest + 1;
    while (end <= words.length && text.includes(` ${words.slice(start, end).join(' ')} `)) end += 1;
    longest = Math.max(longest, end - 1 - start);
  }
  return longest;
};

export const copiedShare = (answer, sources) => {
  const words = simplify(answer).split(' ').filter(Boolean).slice(0, COPY_SCAN_WORDS);
  if (words.length < COPY_MIN_WORDS) return 0;
  const sentences = sources.flatMap((source) => String(source.text).split(/(?<=[.!?\u3002])\s+|\n+/u)).map((sentence) => simplify(sentence)).filter((sentence) => sentence.split(' ').length >= COPY_MIN_WORDS);
  let best = 0;
  for (const sentence of sentences) {
    const run = longestRun(words, ` ${sentence} `);
    if (run >= COPY_SENTENCE_SHARE * sentence.split(' ').length) best = Math.max(best, run / words.length);
  }
  return best;
};

const lowerConfidence = (confidence) => CONFIDENCE[Math.max(0, CONFIDENCE.indexOf(confidence) - 1)];

export const unclearAssessment = () => ({
  verdict: 'unclear',
  issue: 'none',
  completeness: 0,
  conceptsShown: [],
  conceptsMissing: [],
  misconception: '',
  evidence: '',
  confidence: 'low',
  meetsCriteria: false,
  missingPrerequisite: 0,
  checks: ['no_usable_grade'],
});

export const normalizeAssessment = (raw, studentMessage, sources = []) => {
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

  let issue = ISSUES.includes(raw?.issue) ? raw.issue : 'none';
  if (checks.includes('student_said_dont_know') || (verdict === 'incorrect' && DONT_KNOW.test(studentMessage))) issue = 'no_knowledge';
  if (issue === 'none' && verdict === 'correct' && HEDGE.test(studentMessage)) {
    issue = 'hedged';
    checks.push('hedge_in_answer');
  }
  if (issue === 'none' && (verdict === 'correct' || verdict === 'partial') && copiedShare(studentMessage, sources) >= COPY_SHARE) {
    issue = 'copied';
    checks.push('copied_from_source');
  }
  if (issue !== 'none' && !ISSUE_VERDICTS[issue].has(verdict)) {
    issue = 'none';
    checks.push('issue_does_not_fit_verdict');
  }

  return {
    verdict,
    issue,
    completeness,
    conceptsShown: list(raw?.conceptsShown),
    conceptsMissing: list(raw?.conceptsMissing),
    misconception: text(raw?.misconception, 200),
    evidence,
    confidence,
    meetsCriteria: raw?.meetsCriteria === true && verdict === 'correct',
    missingPrerequisite: Number.isInteger(raw?.missingPrerequisite) && raw.missingPrerequisite > 0 && verdict !== 'correct' ? raw.missingPrerequisite : 0,
    checks,
  };
};

export const assessAnswer = async ({ provider, plan, progress, tutorQuestion, studentMessage, sources, signal, onMeta }) => {
  const step = plan.steps[assessedStepIndex(progress)];
  try {
    const raw = await provider.generateJson({
      task: 'assessment',
      system: ASSESS_SYSTEM,
      prompt: buildAssessPrompt({ plan, step, tutorQuestion, studentMessage, sources }),
      signal,
      onMeta,
    });
    return normalizeAssessment(raw, studentMessage, [...sources, { text: tutorQuestion ?? '' }]);
  } catch (error) {
    if (error instanceof AppError && error.code === 'bad_response') return unclearAssessment();
    throw error;
  }
};
