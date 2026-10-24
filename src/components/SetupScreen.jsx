import { useRef, useState } from 'react';
import { createLesson } from '../api/client.js';
import { languageName, useI18n } from '../i18n/translate.js';
import { selectPlanChunks } from '../lesson/sources.js';
import FileDrop from './FileDrop.jsx';
import Icon from './Icon.jsx';

const PRESETS = [
  {
    label: '7th grade, French, Socratic',
    language: 'fr',
    text: 'Teach this to 7th graders, in French. Be Socratic: ask questions that lead the student to the idea before explaining it. Keep it under 15 minutes.',
  },
  {
    label: 'כיתה ט׳, עברית',
    language: 'he',
    text: 'למד את החומר תלמיד בכיתה ט׳, בעברית. הסבר בפשטות עם דוגמאות מחיי היומיום, ובדוק הבנה אחרי כל רעיון. עד 20 דקות. מטרה: שהתלמיד יוכל להסביר את הרעיונות המרכזיים במילים שלו.',
  },
  {
    label: 'Exam review, 11th grade',
    language: 'en',
    text: 'Review this with an 11th grade student preparing for an exam, in English. Be concise, focus on the ideas most likely to be tested, and ask exam-style questions. About 10 minutes.',
  },
];

const LESSON_LANGUAGES = ['en', 'he', 'fr', 'es', 'ar', 'ru', 'de', 'it', 'pt', 'am'];

const KEY_ERRORS = ['missing_key', 'invalid_key', 'unknown_provider', 'server_key_restricted', 'server_key_budget', 'quota_exhausted'];

export const DEFAULT_PROMPT = 'Teach this to 7th graders. Explain one idea at a time with everyday examples, and check understanding before moving on. Keep it under 15 minutes. Goal: the student can explain the main ideas in their own words.';

function Section({ number, title, hint, children }) {
  return (
    <section className="min-w-0">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-full border border-line bg-surface text-sm font-medium text-pen">{number}</span>
        <div>
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function SetupScreen({
  upload,
  onFile,
  onRemoveFile,
  teacherPrompt,
  onTeacherPromptChange,
  lessonLanguage,
  onLessonLanguageChange,
  settings,
  needsKey,
  onOpenSettings,
  onLessonReady,
}) {
  const { t, language } = useI18n();
  const [planning, setPlanning] = useState({ status: 'idle', error: null });
  const controllerRef = useRef(null);
  const ready = upload.status === 'ready' && teacherPrompt.trim().length > 0;
  const busy = planning.status === 'planning';

  const start = async () => {
    if (needsKey) {
      onOpenSettings();
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setPlanning({ status: 'planning', error: null });
    const { document } = upload;
    const chunks = selectPlanChunks(document.chunks);
    try {
      const lesson = await createLesson({
        settings,
        teacherPrompt: teacherPrompt.trim(),
        lessonLanguage,
        document: { name: document.name, chunks, totalChunks: document.chunks.length },
        signal: controller.signal,
      });
      setPlanning({ status: 'idle', error: null });
      onLessonReady({ id: crypto.randomUUID(), document, teacherPrompt: teacherPrompt.trim(), ...lesson });
    } catch (error) {
      setPlanning(error.name === 'AbortError' ? { status: 'idle', error: null } : { status: 'error', error });
    } finally {
      controllerRef.current = null;
    }
  };

  const choosePreset = (preset) => {
    onTeacherPromptChange(preset.text);
    onLessonLanguageChange(preset.language);
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
      <div className="max-w-2xl">
        <h1 className="font-display text-[2.1rem] font-bold leading-[1.1] tracking-tight sm:text-[2.75rem]">{t('setup.title')}</h1>
        <p className="mt-4 text-[17px] leading-relaxed text-muted">{t('setup.intro')}</p>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:gap-12">
        <Section number="1" title={t('setup.material')} hint={t('setup.materialHint')}>
          <FileDrop upload={upload} onFile={onFile} onRemove={onRemoveFile} />
          <p className="mt-3 flex gap-2 text-sm leading-relaxed text-muted">
            <Icon name="info" className="mt-0.5 size-4 shrink-0" />
            <span>{t('setup.privacy')}</span>
          </p>
        </Section>

        <Section number="2" title={t('setup.instructions')} hint={t('setup.instructionsHint')}>
          <label htmlFor="teacher-prompt" className="sr-only">{t('setup.instructions')}</label>
          <textarea
            id="teacher-prompt"
            dir="auto"
            rows={6}
            maxLength={3000}
            value={teacherPrompt}
            onChange={(event) => onTeacherPromptChange(event.target.value)}
            className="field resize-y leading-relaxed"
            placeholder={t('setup.placeholder')}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">{t('setup.examples')}</span>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                dir="auto"
                onClick={() => choosePreset(preset)}
                className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink hover:border-pen hover:text-pen"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="mt-5">
            <label htmlFor="lesson-language" className="mb-1.5 block text-sm font-medium">{t('setup.lessonLanguage')}</label>
            <select
              id="lesson-language"
              value={lessonLanguage}
              onChange={(event) => onLessonLanguageChange(event.target.value)}
              className="field sm:max-w-xs"
              aria-describedby="lesson-language-hint"
            >
              <option value="">{t('setup.lessonLanguageAuto')}</option>
              {LESSON_LANGUAGES.map((code) => (
                <option key={code} value={code}>{languageName(code, language)}</option>
              ))}
            </select>
            <p id="lesson-language-hint" className="mt-1.5 text-sm text-muted">{t('setup.lessonLanguageHint')}</p>
          </div>
        </Section>
      </div>

      <div className="mt-10 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted" aria-live="polite">
          {busy && t('setup.planning')}
          {!busy && needsKey && (
            <span>
              {t('setup.needKey')}{' '}
              <button type="button" onClick={onOpenSettings} className="font-medium text-pen underline underline-offset-2">{t('setup.openSettings')}</button>
            </span>
          )}
          {!busy && !needsKey && upload.status !== 'ready' && t('setup.needFile')}
          {!busy && !needsKey && upload.status === 'ready' && !teacherPrompt.trim() && t('setup.needInstructions')}
        </div>
        <div className="flex gap-2">
          {busy && (
            <button type="button" className="btn-secondary" onClick={() => controllerRef.current?.abort()}>{t('setup.cancel')}</button>
          )}
          <button type="button" className="btn-primary px-6 py-3 text-base" disabled={!ready || busy} onClick={start}>
            {busy ? t('setup.planningButton') : t('setup.start')}
            {busy ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" /> : <Icon name="send" className="size-4.5" />}
          </button>
        </div>
      </div>

      {planning.status === 'error' && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <p className="flex gap-2 text-sm text-danger">
            <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
            <span>{t('setup.planFailed')} {t(`errors.${planning.error.code}`, {}, planning.error.message)}</span>
          </p>
          {KEY_ERRORS.includes(planning.error.code) ? (
            <button type="button" className="btn-secondary shrink-0" onClick={onOpenSettings}>{t('setup.checkKey')}</button>
          ) : (
            planning.error.retryable && <button type="button" className="btn-secondary shrink-0" onClick={start}>{t('setup.tryAgain')}</button>
          )}
        </div>
      )}
    </main>
  );
}
