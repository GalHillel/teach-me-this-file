import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/translate.js';
import { lessonSummary } from '../lesson/chatReducer.js';
import { useTutor } from '../lesson/useTutor.js';
import ChatMessage from './ChatMessage.jsx';
import Composer from './Composer.jsx';
import Dialog from './Dialog.jsx';
import Icon from './Icon.jsx';
import LessonPlanPanel from './LessonPlanPanel.jsx';
import SourcePanel from './SourcePanel.jsx';

const PHASE_KEYS = {
  waiting: 'lesson.thinking',
  assessing: 'lesson.assessing',
  teaching: 'lesson.writing',
};

const FINISH_MOVES = new Set(['finish', 'review_and_finish', 'review_finish']);

const KEY_ERRORS = ['missing_key', 'invalid_key', 'unknown_provider', 'server_key_restricted', 'server_key_budget', 'quota_exhausted'];

const OUTCOME_STYLES = {
  mastered: 'bg-success',
  learned: 'bg-success/60',
  recovered: 'bg-marker',
  review: 'bg-danger/70',
};

function TypingIndicator({ phase }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 text-sm text-muted" role="status">
      <span className="flex gap-1" aria-hidden="true">
        <span className="typing-dot size-1.5 rounded-full bg-pen" />
        <span className="typing-dot size-1.5 rounded-full bg-pen" />
        <span className="typing-dot size-1.5 rounded-full bg-pen" />
      </span>
      {t(PHASE_KEYS[phase] ?? 'lesson.thinking')}
    </div>
  );
}

function Banner({ children, onDismiss, tone = 'info' }) {
  const { t } = useI18n();
  return (
    <div className={`flex items-start gap-2 rounded-xl px-4 py-3 text-sm ${tone === 'warning' ? 'bg-marker-soft text-ink' : 'bg-pen-soft text-ink'}`} role="status">
      <Icon name={tone === 'warning' ? 'alert' : 'info'} className="mt-0.5 size-4 shrink-0 text-muted" />
      <span className="flex-1">{children}</span>
      <button type="button" onClick={onDismiss} className="-m-1 rounded p-1 text-muted hover:text-ink" aria-label={t('lesson.dismiss')}>
        <Icon name="close" className="size-4" />
      </button>
    </div>
  );
}

function ErrorNotice({ failed, onRetry, onDismiss, onOpenSettings }) {
  const { t } = useI18n();
  const keyProblem = KEY_ERRORS.includes(failed.code);
  return (
    <div className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3" role="alert">
      <p className="flex gap-2 text-sm text-danger">
        <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
        <span>{t('lesson.couldNotAnswer')} {t(`errors.${failed.code}`, {}, failed.message)}</span>
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {keyProblem && <button type="button" className="btn-secondary py-1.5" onClick={onOpenSettings}>{t('setup.checkKey')}</button>}
        {failed.retryable && (
          <button type="button" className="btn-secondary py-1.5" onClick={onRetry}>
            <Icon name="retry" className="size-4" />
            {t('setup.tryAgain')}
          </button>
        )}
        <button type="button" className="btn-ghost py-1.5" onClick={onDismiss}>{t('lesson.dismiss')}</button>
      </div>
    </div>
  );
}

const summaryText = (plan, summary, t) =>
  [
    plan.title,
    '',
    ...plan.steps.map((step, index) => `${index + 1}. ${step.title}`),
    '',
    ...(summary.review.length
      ? [`${t('summary.review')}:`, ...summary.review.map((item) => `- ${item.title}${item.result ? ` (${t(`reviewResult.${item.result}`)})` : ''}`)]
      : [t('summary.allGood')]),
  ].join('\n');

function CompletionCard({ plan, progress, busy, onReview, onNewLesson }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const summary = lessonSummary(plan, progress);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summaryText(plan, summary, t));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="rounded-2xl border border-line bg-paper px-5 py-5" aria-labelledby="summary-title">
      <h2 id="summary-title" className="font-display text-lg font-semibold">{t('summary.title')}</h2>
      <p className="mt-1 text-sm text-muted">{t('summary.intro', { total: summary.total, title: plan.title })}</p>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {Object.entries(summary.counts).filter(([, count]) => count > 0).map(([outcome, count]) => (
          <li key={outcome} className="flex items-center gap-2 text-sm">
            <span className={`size-2.5 rounded-full ${OUTCOME_STYLES[outcome]}`} aria-hidden="true" />
            <span className="font-medium tabular-nums">{count}</span>
            <span className="text-muted">{t(`outcome.${outcome}`)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4">
        {summary.review.length > 0 ? (
          <>
            <h3 className="text-sm font-semibold">{t('summary.review')}</h3>
            <ul className="mt-1.5 space-y-1 text-sm">
              {summary.review.map((item) => (
                <li key={item.index} className="flex flex-wrap items-center gap-2">
                  <span dir="auto">{item.title}</span>
                  {item.result && (
                    <span className={`rounded-full px-2 py-0.5 text-xs ${item.result === 'pass' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>
                      {t(`reviewResult.${item.result}`)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {summary.reviewed && (
              <p className="mt-2 text-sm text-muted">
                {t('summary.reviewResult', { passed: summary.review.filter((item) => item.result === 'pass').length, total: summary.review.length })}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm">{t('summary.allGood')}</p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {summary.review.length > 0 && !summary.reviewed && (
          <button type="button" className="btn-primary py-1.5" onClick={onReview} disabled={busy}>
            <Icon name="retry" className="size-4" />
            {t('summary.practise', { count: summary.review.length })}
          </button>
        )}
        <button type="button" className="btn-secondary py-1.5" onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} className="size-4" />
          {copied ? t('summary.copied') : t('summary.copy')}
        </button>
        <button type="button" className="btn-ghost py-1.5" onClick={onNewLesson}>{t('summary.newLesson')}</button>
      </div>
      <p className="mt-3 text-xs text-muted">{t('summary.followUp')}</p>
    </section>
  );
}

function StepCounter({ plan, progress }) {
  const { t } = useI18n();
  const completed = progress.status !== 'active';
  const done = progress.steps.filter((step) => step.status === 'done').length;
  const label = progress.status === 'reviewing'
    ? t('lesson.reviewOf', { current: progress.review.position + 1, total: progress.review.queue.length })
    : completed ? t('lesson.complete') : t('lesson.stepOf', { current: progress.currentStep + 1, total: plan.steps.length });
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="whitespace-nowrap text-sm font-medium tabular-nums">{label}</span>
      <div className="flex h-2 w-24 gap-0.5 sm:w-36" role="progressbar" aria-label={t('lesson.progress')} aria-valuemin={0} aria-valuemax={plan.steps.length} aria-valuenow={done}>
        {progress.steps.map((step, index) => (
          <span
            key={plan.steps[index].id}
            className={`flex-1 rounded-full ${step.status === 'done' ? OUTCOME_STYLES[step.outcome] ?? 'bg-success' : step.status === 'active' && !completed ? 'bg-pen' : 'bg-line'}`}
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

  return { ref, pinned, setPinned, onScroll, jump };
};

export default function LessonScreen({ lesson, settings, onOpenSettings, onNewLesson }) {
  const { t } = useI18n();
  const tutor = useTutor({ lesson, settings });
  const [planOpen, setPlanOpen] = useState(false);
  const [sourceSelection, setSourceSelection] = useState(null);
  const chunkLabels = useMemo(() => new Map(lesson.document.chunks.map((chunk) => [chunk.id, chunk.label])), [lesson.document.chunks]);
  const lastContent = tutor.messages.at(-1)?.content;
  const { ref: scrollRef, pinned, setPinned, onScroll, jump } = useStickToBottom(`${tutor.messages.length}:${lastContent?.length}:${tutor.turn.status}`);
  const openSource = useCallback((message, source) => setSourceSelection({ message, source, documentName: lesson.document.name }), [lesson.document.name]);
  const { plan, progress } = tutor;
  const showTyping = tutor.busy && !tutor.messages.some((message) => message.status === 'streaming');
  const completed = progress.status === 'completed';
  const lastFinishId = [...tutor.messages].reverse().find((message) => message.status === 'done' && FINISH_MOVES.has(message.move))?.id;

  const { busy, stop } = tutor;
  useEffect(() => {
    if (!busy) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, stop]);

  const showStep = useCallback((index) => {
    setPlanOpen(false);
    const target = scrollRef.current?.querySelector(`[data-step-index="${index}"]`);
    if (!target) return;
    setPinned(false);
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.focus?.({ preventScroll: true });
  }, [scrollRef, setPinned]);

  return (
    <div className="grid min-h-0 flex-1 lg:grid-cols-[19rem_1fr]">
      <aside className="hidden min-h-0 overflow-y-auto border-e border-line bg-surface px-5 py-6 lg:block" aria-label={t('lesson.plan')}>
        <h2 className="font-display text-xl font-semibold leading-snug" dir="auto">{plan.title}</h2>
        <div className="mt-4">
          <LessonPlanPanel plan={plan} progress={progress} onSelectStep={showStep} />
        </div>
      </aside>

      <section className="relative flex min-h-0 flex-col" aria-label={t('lesson.chat')}>
        <a href="#answer" className="sr-only z-10 rounded-lg bg-surface px-3 py-2 text-sm font-medium text-pen shadow focus:not-sr-only focus:absolute focus:start-3 focus:top-3">
          {t('lesson.skipToAnswer')}
        </a>
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface/80 px-4 py-2.5 backdrop-blur sm:px-6">
          <h1 className="min-w-0 truncate font-display text-base font-semibold lg:sr-only" dir="auto">{plan.title}</h1>
          <div className="flex items-center gap-2 lg:ms-auto">
            <StepCounter plan={plan} progress={progress} />
            <button type="button" className="btn-ghost px-2 lg:hidden" onClick={() => setPlanOpen(true)} aria-label={t('lesson.showPlan')}>
              <Icon name="list" />
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto bg-surface">
            <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 px-4 py-6 sm:border-s-2 sm:border-margin/50 sm:px-8" role="log" aria-live="polite" aria-relevant="additions" aria-label={t('lesson.chat')}>
              {tutor.restored && <Banner onDismiss={tutor.dismissRestored}>{t('lesson.restored')}</Banner>}
              {tutor.notice?.code === 'backup_model' && (
                <Banner tone="warning" onDismiss={tutor.dismissNotice}>{t('lesson.backupModel', { model: tutor.notice.model })}</Banner>
              )}
              {tutor.messages.map((message) => (
                <Fragment key={message.id}>
                  <ChatMessage message={message} chunkLabels={chunkLabels} onOpenSource={openSource} />
                  {completed && message.id === lastFinishId && (
                    <CompletionCard plan={plan} progress={progress} busy={tutor.busy} onReview={tutor.review} onNewLesson={onNewLesson} />
                  )}
                </Fragment>
              ))}
              {showTyping && <TypingIndicator phase={tutor.turn.status} />}
              {tutor.failed && (
                <ErrorNotice failed={tutor.failed} onRetry={tutor.retry} onDismiss={tutor.dismissError} onOpenSettings={onOpenSettings} />
              )}
            </div>
          </div>
          {!pinned && (
            <button type="button" onClick={jump} className="btn-secondary absolute bottom-4 left-1/2 -translate-x-1/2 py-1.5 shadow-md">
              {t('lesson.jumpLatest')}
            </button>
          )}
        </div>

        <Composer busy={tutor.busy} completed={completed} onSend={tutor.send} onStop={tutor.stop} />
      </section>

      <Dialog open={planOpen} onClose={() => setPlanOpen(false)} title={plan.title} variant="side" labelId="plan-title">
        <LessonPlanPanel plan={plan} progress={progress} onSelectStep={showStep} />
      </Dialog>

      <SourcePanel selection={sourceSelection} chunks={lesson.document.chunks} onClose={() => setSourceSelection(null)} />
    </div>
  );
}
