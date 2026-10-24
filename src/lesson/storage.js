const LESSON_KEY = 'tmtf.lesson';
const CHAT_KEY = 'tmtf.chat';
const VERSION = 2;

const write = (key, value) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

const read = (key) => {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
};

export const saveLesson = (lesson) => write(LESSON_KEY, { version: VERSION, lesson: { ...lesson, resume: undefined } });

export const saveChat = (lessonId, chat) => write(CHAT_KEY, { version: VERSION, lessonId, chat });

export const loadLesson = () => {
  const saved = read(LESSON_KEY);
  if (saved?.version !== VERSION || !saved.lesson?.plan || !saved.lesson.document) return null;
  const chat = read(CHAT_KEY);
  const resume = chat?.version === VERSION && chat.lessonId === saved.lesson.id && chat.chat?.progress ? chat.chat : null;
  return { ...saved.lesson, resume };
};

export const clearLesson = () => {
  try {
    sessionStorage.removeItem(LESSON_KEY);
    sessionStorage.removeItem(CHAT_KEY);
  } catch {
    return;
  }
};
