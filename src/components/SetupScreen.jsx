import { useRef, useState } from 'react';
import { createLesson } from '../api/client.js';
import { selectPlanChunks } from '../lesson/sources.js';
import FileDrop from './FileDrop.jsx';
import Icon from './Icon.jsx';

const PRESETS = [
  {
    label: '7th grade, French, Socratic',
    text: 'Teach this to 7th graders, in French. Be Socratic: ask questions that lead the student to the idea before explaining it. Keep it under 15 minutes.',
  },
  {
    label: 'כיתה ט׳, עברית',
    text: 'למד את החומר תלמיד בכיתה ט׳, בעברית. הסבר בפשטות עם דוגמאות מחיי היומיום, ובדוק הבנה אחרי כל רעיון. עד 20 דקות. מטרה: שהתלמיד יוכל להסביר את הרעיונות המרכזיים במילים שלו.',
  },
  {
    label: 'Exam review, 11th grade',
    text: 'Review this with an 11th grade student preparing for an exam, in English. Be concise, focus on the ideas most likely to be tested, and ask exam-style questions. About 10 minutes.',
  },
];

export const DEFAULT_PROMPT = 'Teach this to 7th graders, in English. Explain one idea at a time with everyday examples, and check understanding before moving on. Keep it under 15 minutes. Goal: the student can explain the main ideas in their own words.';

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

export default function SetupScreen({ upload, onFile, onRemoveFile, teacherPrompt, onTeacherPromptChange, settings, needsKey, onOpenSettings, onLessonReady }) {
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

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-10 sm:px-6 sm:pt-14">
      <div className="max-w-2xl">
        <h1 className="font-display text-[2.1rem] font-bold leading-[1.1] tracking-tight sm:text-[2.75rem]">
          Turn a file into a lesson, taught one step at a time.
        </h1>
        <p className="mt-4 text-[17px] leading-relaxed text-muted">
          Upload the class material and describe the student. The tutor builds a lesson plan from the file, explains one idea at a time, and checks the student&apos;s understanding with a question before moving on.
        </p>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-2 lg:gap-12">
        <Section number="1" title="The material" hint="What should the student learn from?">
          <FileDrop upload={upload} onFile={onFile} onRemove={onRemoveFile} />
        </Section>

        <Section number="2" title="Teacher instructions" hint="Age, language, teaching style, length and goals.">
          <label htmlFor="teacher-prompt" className="sr-only">Teacher instructions</label>
          <textarea
            id="teacher-prompt"
            dir="auto"
            rows={6}
            maxLength={3000}
            value={teacherPrompt}
            onChange={(event) => onTeacherPromptChange(event.target.value)}
            className="field resize-y leading-relaxed"
            placeholder="Teach this to 7th graders, in French. Be Socratic. Keep it under 15 minutes."
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Examples:</span>
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                dir="auto"
                onClick={() => onTeacherPromptChange(preset.text)}
                className="rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink hover:border-pen hover:text-pen"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </Section>
      </div>

      <div className="mt-10 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted" aria-live="polite">
          {busy && 'Reading the material and planning the lesson. This can take up to a minute for long files.'}
          {!busy && needsKey && (
            <span>
              Add an AI key first.{' '}
              <button type="button" onClick={onOpenSettings} className="font-medium text-pen underline underline-offset-2">Open settings</button>
            </span>
          )}
          {!busy && !needsKey && upload.status !== 'ready' && 'Add a file to continue.'}
          {!busy && !needsKey && upload.status === 'ready' && !teacherPrompt.trim() && 'Write the teacher instructions to continue.'}
        </div>
        <div className="flex gap-2">
          {busy && (
            <button type="button" className="btn-secondary" onClick={() => controllerRef.current?.abort()}>Cancel</button>
          )}
          <button type="button" className="btn-primary px-6 py-3 text-base" disabled={!ready || busy} onClick={start}>
            {busy ? 'Planning the lesson' : 'Start lesson'}
            {busy ? <span className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" /> : <Icon name="send" className="size-4.5" />}
          </button>
        </div>
      </div>

      {planning.status === 'error' && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <p className="flex gap-2 text-sm text-danger">
            <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
            <span>Could not plan the lesson. {planning.error.message}</span>
          </p>
          {['missing_key', 'invalid_key', 'unknown_provider'].includes(planning.error.code) ? (
            <button type="button" className="btn-secondary shrink-0" onClick={onOpenSettings}>Check the key</button>
          ) : (
            planning.error.retryable && <button type="button" className="btn-secondary shrink-0" onClick={start}>Try again</button>
          )}
        </div>
      )}
    </main>
  );
}
