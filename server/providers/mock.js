const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

const between = (text, tag) => text.split(`<${tag}>`)[1]?.split(`</${tag}>`)[0]?.trim() ?? '';

const mockPlan = (prompt) => {
  const ids = [...prompt.matchAll(/\[(c\d+) \|/g)].map((match) => match[1]);
  const hebrew = /[\u0590-\u05FF]/.test(between(prompt, 'teacher_instructions'));
  return {
    title: 'Mock lesson',
    languageCode: hebrew ? 'he' : 'en',
    audience: 'Test students',
    durationMinutes: 10,
    style: 'Short explanations followed by a question.',
    objectives: ['Understand the first idea', 'Understand the second idea'],
    steps: [0, 1, 2].map((index) => ({
      title: `Idea ${index + 1}`,
      goal: `Understand idea ${index + 1}`,
      keyConcepts: [`concept ${index + 1}`],
      checkQuestion: `What is idea ${index + 1} about?`,
      successCriteria: 'Mentions the main point.',
      sourceIds: ids.slice(index, index + 1),
    })),
    notes: '',
  };
};

const mockAssessment = (prompt) => {
  const answer = between(prompt, 'student_message').toLowerCase();
  const base = { conceptsShown: [], conceptsMissing: [], misconception: '', evidence: '', confidence: 'high' };
  if (answer.includes('wrong') || answer.includes('no idea')) {
    return { ...base, verdict: 'incorrect', completeness: 0, conceptsMissing: ['the main point'], misconception: 'confused the idea' };
  }
  if (answer.includes('partly')) return { ...base, verdict: 'partial', completeness: 0.5, conceptsShown: ['part of it'], conceptsMissing: ['the rest'] };
  if (answer.includes('off topic')) return { ...base, verdict: 'off_topic', completeness: 0 };
  if (answer.endsWith('?')) return { ...base, verdict: 'question', completeness: 0 };
  return { ...base, verdict: 'correct', completeness: 1, conceptsShown: ['the main point'], confidence: answer.includes('maybe') ? 'low' : 'high' };
};

export const createMockProvider = ({ delayMs = 40 } = {}) => ({
  name: 'mock',
  model: 'mock',

  async generateJson({ task, prompt, signal, onMeta }) {
    await wait(delayMs * 5, signal);
    onMeta?.({ model: 'mock', backup: false, fallbacks: 0 });
    return task === 'plan' ? mockPlan(prompt) : mockAssessment(prompt);
  },

  async *streamText({ system, signal, onMeta }) {
    onMeta?.({ model: 'mock', backup: false, fallbacks: 0 });
    const source = between(system, 'sources').split('\n').find((line) => line && !line.startsWith('[')) ?? '';
    const reply = `Mock tutor reply. The source says: ${source.slice(0, 220)} What do you think this means?`;
    for (const word of reply.split(/(?<= )/)) {
      await wait(delayMs, signal);
      yield word;
    }
  },
});
