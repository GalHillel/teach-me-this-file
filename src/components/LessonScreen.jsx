import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTutor } from '../lesson/useTutor.js';
import ChatMessage from './ChatMessage.jsx';
import Composer from './Composer.jsx';
import Dialog from './Dialog.jsx';
import Icon from './Icon.jsx';
import LessonPlanPanel from './LessonPlanPanel.jsx';
import SourcePanel from './SourcePanel.jsx';

const PHASE_LABELS = {
  waiting: 'Tutor is thinking',
  assessing: 'Checking your answer',
  teaching: 'Tutor is writing',
};

function TypingIndicator({ phase }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted" role="status">
      <span className="flex gap-1" aria-hidden="true">
        <span className="typing-dot size-1.5 rounded-full bg-pen" />
        <span className="typing-dot size-1.5 rounded-full bg-pen" />
        <span className="typing-dot size-1.5 rounded-full bg-pen" />
      </span>
      {PHASE_LABELS[phase]}
    </div>
  );
}

function ErrorNotice({ failed, onRetry, onDismiss, onOpenSettings }) {
  const keyProblem = ['missing_key', 'invalid_key', 'unknown_provider'].includes(failed.code);
  return (
    <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3" role="alert">
      <p className="flex gap-2 text-sm text-danger">
        <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
        <span>The tutor could not answer. {failed.message}</span>
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {keyProblem && <button type="button" className="btn-secondary py-1.5" onClick={onOpenSettings}>Check the key</button>}
        <button type="button" className="btn-secondary py-1.5" onClick={onRetry}>
          <Icon name="retry" className="size-4" />
          Try again
        </button>
        <button type="button" className="btn-ghost py-1.5" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

function StepCounter({ plan, progress }) {
  const completed = progress.status === 'completed';
  const done = progress.steps.filter((step) => step.status === 'done').length;
  return (
    <div className="flex items-center gap-3">
      <span className="whitespace-nowrap text-sm font-medium tabular-nums">
        {completed ? 'Lesson complete' : `Step ${progress.currentStep + 1} of ${plan.steps.length}`}
      </span>
      <div className="flex h-2 w-24 gap-0.5 sm:w-36" role="progressbar" aria-label="Lesson progress" aria-valuemin={0} aria-valuemax={plan.steps.length} aria-valuenow={done}>
        {progress.steps.map((step, index) => (
          <span
            key={plan.steps[index].id}
            className={`flex-1 rounded-full ${step.status === 'done' ? (step.outcome === 'revealed' ? 'bg-amber-400' : 'bg-success') : step.status === 'active' && !completed ? 'bg-pen' : 'bg-line'}`}
          />
        ))}
      </div>
    </div>
  );
}

const useStickToBottom = (dependency) => {
  const ref = useRef(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (pinned && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [dependency, pinned]);

  const onScroll = useCallback(() => {
    const element = ref.current;
    setPinned(element.scrollHeight - element.scrollTop - element.clientHeight < 80);
  }, []);

  const jump = useCallback(() => {
    ref.current.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' });
    setPinned(true);
  }, []);

  return { ref, pinned, onScroll, jump };
};

export default function LessonScreen({ lesson, settings, onOpenSettings }) {
  const tutor = useTutor({ lesson, settings });
  const [planOpen, setPlanOpen] = useState(false);
  const [sourceSelection, setSourceSelection] = useState(null);
  const chunkLabels = useMemo(() => new Map(lesson.document.chunks.map((chunk) => [chunk.id, chunk.label])), [lesson.document.chunks]);
  const lastContent = tutor.messages.at(-1)?.content;
  const { ref: scrollRef, pinned, onScroll, jump } = useStickToBottom(`${tutor.messages.length}:${lastContent?.length}:${tutor.turn.status}`);
  const openSource = useCallback((message, source) => setSourceSelection({ message, source, documentName: lesson.document.name }), [lesson.document.name]);
  const { plan, progress } = tutor;
  const showTyping = tutor.busy && !tutor.messages.some((message) => message.status === 'streaming');

  return (
    <div className="grid min-h-0 flex-1 lg:grid-cols-[19rem_1fr]">
      <aside className="hidden min-h-0 overflow-y-auto border-e border-line bg-surface px-5 py-6 lg:block" aria-label="Lesson plan">
        <h2 className="font-display text-xl font-semibold leading-snug" dir="auto">{plan.title}</h2>
        <div className="mt-4">
          <LessonPlanPanel plan={plan} progress={progress} />
        </div>
      </aside>

      <section className="flex min-h-0 flex-col" aria-label="Lesson chat">
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface/80 px-4 py-2.5 backdrop-blur sm:px-6">
          <h1 className="min-w-0 truncate font-display text-base font-semibold lg:sr-only" dir="auto">{plan.title}</h1>
          <div className="flex items-center gap-2 lg:ms-auto">
            <StepCounter plan={plan} progress={progress} />
            <button type="button" className="btn-ghost px-2 lg:hidden" onClick={() => setPlanOpen(true)} aria-label="Show the lesson plan">
              <Icon name="list" />
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} onScroll={onScroll} className="notebook h-full overflow-y-auto">
            <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 sm:ps-16 sm:pe-8">
              {tutor.messages.map((message) => (
                <ChatMessage key={message.id} message={message} chunkLabels={chunkLabels} onOpenSource={openSource} />
              ))}
              {showTyping && <TypingIndicator phase={tutor.turn.status} />}
              {tutor.failed && (
                <ErrorNotice failed={tutor.failed} onRetry={tutor.retry} onDismiss={tutor.dismissError} onOpenSettings={onOpenSettings} />
              )}
            </div>
          </div>
          {!pinned && (
            <button type="button" onClick={jump} className="btn-secondary absolute bottom-4 left-1/2 -translate-x-1/2 py-1.5 shadow-md">
              Jump to latest
            </button>
          )}
        </div>

        <Composer busy={tutor.busy} completed={progress.status === 'completed'} onSend={tutor.send} onStop={tutor.stop} />
      </section>

      <Dialog open={planOpen} onClose={() => setPlanOpen(false)} title={plan.title} variant="side" labelId="plan-title">
        <LessonPlanPanel plan={plan} progress={progress} />
      </Dialog>

      <SourcePanel selection={sourceSelection} chunks={lesson.document.chunks} onClose={() => setSourceSelection(null)} />
    </div>
  );
}
