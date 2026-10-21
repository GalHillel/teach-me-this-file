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
  const hebrew = /[֐-׿]/.test(between(prompt, 'teacher_instructions'));
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
  if (answer.includes('wrong') || answer.includes('no idea')) {
    return { verdict: 'incorrect', understood: '', missing: 'the main point', misconception: 'confused the idea' };
  }
  if (answer.includes('partly')) return { verdict: 'partial', understood: 'part of it', missing: 'the rest', misconception: '' };
  if (answer.endsWith('?')) return { verdict: 'question', understood: '', missing: '', misconception: '' };
  return { verdict: 'correct', understood: 'the main point', missing: '', misconception: '' };
};

export const createMockProvider = ({ delayMs = 40 } = {}) => ({
  name: 'mock',
  model: 'mock',

  async generateJson({ task, prompt, signal }) {
    await wait(delayMs * 5, signal);
    return task === 'plan' ? mockPlan(prompt) : mockAssessment(prompt);
  },

  async *streamText({ system, signal }) {
    const source = between(system, 'sources').split('\n').find((line) => line && !line.startsWith('[')) ?? '';
    const move = system.split('What to do now:')[1]?.trim().split('\n')[0] ?? '';
    const reply = `(Mock tutor, ${move.slice(0, 60)}) The source says: ${source.slice(0, 220)} What do you think this means?`;
    for (const word of reply.split(/(?<= )/)) {
      await wait(delayMs, signal);
      yield word;
    }
  },
});
