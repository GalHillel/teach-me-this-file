import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/translate.js';
import { inFinalCheck } from '../../shared/lesson.js';
import { lessonSummary } from '../lesson/chatReducer.js';
import { useTutor } from '../lesson/useTutor.js';
import ChatMessage from './ChatMessage.jsx';
import Composer from './Composer.jsx';
import Dialog from './Dialog.jsx';
import DocumentPanel from './DocumentPanel.jsx';
import Icon from './Icon.jsx';
import LearningMap from './LearningMap.jsx';
import LessonPlanPanel from './LessonPlanPanel.jsx';
import { LEVEL_STYLES } from './levels.js';
import { shownCount, stepView } from '../lesson/progressView.js';
import SourcePanel from './SourcePanel.jsx';

const PHASE_KEYS = {
  waiting: 'lesson.thinking',
  assessing: 'lesson.assessing',
  teaching: 'lesson.writing',
};

const FINISH_MOVES = new Set(['final_finish', 'finish_skipped', 'review_finish', 'finish', 'review_and_finish']);

const SUMMARY_LEVELS = ['applied', 'shown', 'shown_with_help', 'needs_review', 'needs_practice'];

const DAY_MS = 86400000;

const KEY_ERRORS = ['missing_key', 'invalid_key', 'unknown_provider', 'server_key_restricted', 'server_key_budget', 'quota_exhausted'];


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

const reviewDate = (days, language) => new Intl.DateTimeFormat(language, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(Date.now() + days * DAY_MS));

const summaryLines = (plan, summary, t, language) => {
  const lines = [];
  if (summary.final) lines.push(summary.final.skipped ? t('summary.finalSkipped') : t('summary.final', summary.final), '');
  for (const level of SUMMARY_LEVELS) {
    if (!summary.groups[level].length) continue;
    lines.push(`${t(`level.${level}`)}:`);
    summary.groups[level].forEach((step) => lines.push(`- ${step.title}${step.signals.length ? ` (${step.signals.map((signal) => t(`signal.${signal}`)).join(', ')})` : ''}`));
    lines.push('');
  }
  if (summary.schedule.length) {
    lines.push(`${t('summary.schedule')}:`);
    summary.schedule.forEach((item) => lines.push(`- ${reviewDate(item.days, language)}: ${item.title}`));
  }
  return lines;
};

const summaryText = (plan, summary, t, language) => [plan.title, '', ...summaryLines(plan, summary, t, language)].join('\n');

const notesMarkdown = (plan, messages, summary, t, language) => {
  const lines = [`# ${plan.title}`, ''];
  if (plan.objectives.length) lines.push(`## ${t('plan.goals')}`, ...plan.objectives.map((item) => `- ${item}`), '');
  lines.push(`## ${t('summary.title')}`, '', ...summaryLines(plan, summary, t, language), '');
  lines.push(`## ${t('lesson.chat')}`, '');
  messages
    .filter((message) => (message.role === 'tutor' || message.role === 'student') && message.content)
    .forEach((message) => lines.push(`**${message.role === 'tutor' ? t('chat.tutor') : t('summary.you')}:** ${message.content}`, ''));
  return lines.join('\n');
};

const downloadText = (name, text) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

function CompletionCard({ plan, progress, messages, busy, onReview, onNewLesson }) {
  const { t, language } = useI18n();
  const [copied, setCopied] = useState(false);
  const summary = lessonSummary(plan, progress);
  const practicePassed = summary.practice.filter((item) => item.result === 'pass').length;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summaryText(plan, summary, t, language));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="step-enter rounded-2xl border border-line bg-paper px-5 py-5" aria-labelledby="summary-title" aria-live="off">
      <h2 id="summary-title" className="font-display text-lg font-semibold">{t('summary.title')}</h2>
      <p className="mt-1 text-sm text-muted">{t('summary.basedOn')}</p>

      {summary.final && (
        <p className="mt-3 flex items-center gap-2 text-sm font-medium">
          <Icon name="target" className="size-4 text-applied" />
          {summary.final.skipped ? t('summary.finalSkipped') : t('summary.final', summary.final)}
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {SUMMARY_LEVELS.filter((level) => summary.groups[level].length).map((level) => (
          <div key={level}>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <span className={`size-2.5 rounded-full ${LEVEL_STYLES[level].dot}`} aria-hidden="true" />
              {t(`level.${level}`)}
            </h3>
            <ul className="mt-1.5 space-y-1.5 text-sm">
              {summary.groups[level].map((step) => (
                <li key={step.index}>
                  <span dir="auto" className="block">{step.title}</span>
                  {step.signals.length > 0 && <span className="block text-xs text-muted">{step.signals.map((signal) => t(`signal.${signal}`)).join(', ')}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {summary.practiced && <p className="mt-3 text-sm text-muted">{t('summary.practiceResult', { passed: practicePassed, total: summary.practice.length })}</p>}

      {summary.schedule.length > 0 && (
        <div className="mt-5 rounded-xl border border-line bg-surface px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Icon name="calendar" className="size-4 text-muted" />
            {t('summary.schedule')}
          </h3>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {summary.schedule.map((item) => (
              <Fragment key={item.index}>
                <dt className="whitespace-nowrap font-medium">
                  {t('summary.inDays', { count: item.days })}
                  <span className="ms-1.5 font-normal text-muted">{reviewDate(item.days, language)}</span>
                </dt>
                <dd dir="auto">{item.title}</dd>
              </Fragment>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted">{t('summary.scheduleNote')}</p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {summary.practice.length > 0 && !summary.practiced && (
          <button type="button" className="btn-primary py-1.5" onClick={onReview} disabled={busy}>
            <Icon name="retry" className="size-4" />
            {t('summary.practise', { count: summary.practice.length })}
          </button>
        )}
        <button type="button" className="btn-secondary py-1.5" onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} className="size-4" />
          {copied ? t('summary.copied') : t('summary.copy')}
        </button>
        <button type="button" className="btn-secondary py-1.5" onClick={() => downloadText('lesson-notes.md', notesMarkdown(plan, messages, summary, t, language))}>
          <Icon name="download" className="size-4" />
          {t('summary.download')}
        </button>
        <button type="button" className="btn-ghost py-1.5" onClick={onNewLesson}>{t('summary.newLesson')}</button>
      </div>
      <p className="mt-3 text-xs text-muted">{t('summary.followUp')}</p>
    </section>
  );
}

const focusLabel = (plan, progress, t) => {
  if (progress.status === 'reviewing') {
    const values = { current: progress.review.position + 1, total: progress.review.queue.length };
    return progress.review.kind === 'final' ? t('focus.final', values) : t('focus.practice', values);
  }
  if (progress.status === 'completed') return t('focus.done');
  const detour = progress.steps[progress.currentStep].detour;
  if (Number.isInteger(detour)) return t('focus.detour', { step: detour + 1 });
  return t('focus.step', { current: progress.currentStep + 1, total: plan.steps.length });
};

function StepFocus({ plan, progress }) {
  const { t } = useI18n();
  if (progress.status === 'completed') return null;
  const index = progress.status === 'reviewing' ? progress.review.queue[progress.review.position] : progress.steps[progress.currentStep].detour ?? progress.currentStep;
  const step = plan.steps[index];
  const final = inFinalCheck(progress);
  const special = progress.status === 'reviewing' || Number.isInteger(progress.steps[progress.currentStep].detour);
  return (
    <div className={`border-b border-line px-4 py-2.5 sm:px-6 ${final ? 'bg-pen-soft' : 'bg-surface'}`}>
      <div className="mx-auto flex max-w-3xl flex-wrap items-baseline gap-x-3 gap-y-1">
        {special && <span className={`text-xs font-semibold uppercase tracking-wide ${final ? 'text-pen' : 'text-ink'}`}>{focusLabel(plan, progress, t)}</span>}
        <span dir="auto" className="min-w-0 text-sm font-medium">{step.title}</span>
        {!final && <span dir="auto" className="hidden min-w-0 flex-1 truncate text-sm text-muted md:block">{step.goal}</span>}
      </div>
    </div>
  );
}

function StepCounter({ plan, progress }) {
  const { t } = useI18n();
  const completed = progress.status !== 'active';
  const done = progress.steps.filter((step) => step.status === 'done').length;
  const reviewValues = progress.review ? { current: progress.review.position + 1, total: progress.review.queue.length } : null;
  const label = progress.status === 'reviewing'
    ? t(progress.review.kind === 'final' ? 'lesson.finalOf' : 'lesson.practiceOf', reviewValues)
    : completed ? t('lesson.complete') : t('lesson.stepOf', { current: progress.currentStep + 1, total: plan.steps.length });
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="whitespace-nowrap text-sm font-medium tabular-nums">{label}</span>
      <div className="flex h-2 w-14 gap-0.5 sm:w-36" role="progressbar" aria-label={t('lesson.progress')} aria-valuemin={0} aria-valuemax={plan.steps.length} aria-valuenow={done} aria-valuetext={`${t('plan.done', { done, total: plan.steps.length })}. ${t('plan.shown', { shown: shownCount(progress), total: plan.steps.length })}`}>
        {progress.steps.map((step, index) => (
          <span
            key={plan.steps[index].id}
            className={`flex-1 rounded-full ${LEVEL_STYLES[stepView(progress, index).display].dot}`}
          />
        ))}
      </div>
    </div>
  );
}

const composerMode = (progress) => {
  if (progress.status === 'completed') return 'completed';
  if (progress.status === 'reviewing') return progress.review.kind === 'final' ? 'final' : 'practice';
  return Number.isInteger(progress.steps[progress.currentStep].detour) ? 'detour' : 'learn';
};

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
  const [documentOpen, setDocumentOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
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
    setDocumentOpen(false);
    setMapOpen(false);
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
          <h1 className="min-w-0 truncate font-display text-base font-semibold max-sm:sr-only lg:sr-only" dir="auto">{plan.title}</h1>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1 sm:gap-2">
            <StepCounter plan={plan} progress={progress} />
            <button type="button" className="btn-ghost min-h-10 px-1.5 sm:px-2" onClick={() => setMapOpen(true)} aria-label={t('map.open')} title={t('map.open')}>
              <Icon name="map" />
            </button>
            <button type="button" className="btn-ghost min-h-10 px-1.5 sm:px-2" onClick={() => setDocumentOpen(true)} aria-label={t('doc.title')} title={t('doc.title')}>
              <Icon name="search" />
            </button>
            <button type="button" className="btn-ghost min-h-10 px-1.5 sm:px-2 lg:hidden" onClick={() => setPlanOpen(true)} aria-label={t('lesson.showPlan')}>
              <Icon name="list" />
            </button>
          </div>
        </div>

        <StepFocus plan={plan} progress={progress} />

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
                    <CompletionCard plan={plan} progress={progress} messages={tutor.messages} busy={tutor.busy} onReview={tutor.review} onNewLesson={onNewLesson} />
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

        <Composer busy={tutor.busy} mode={composerMode(progress)} onSend={tutor.send} onStop={tutor.stop} onAsk={tutor.ask} />
      </section>

      <Dialog open={planOpen} onClose={() => setPlanOpen(false)} title={plan.title} variant="side" labelId="plan-title">
        <LessonPlanPanel plan={plan} progress={progress} onSelectStep={showStep} />
      </Dialog>

      <SourcePanel selection={sourceSelection} chunks={lesson.document.chunks} onClose={() => setSourceSelection(null)} />

      <LearningMap open={mapOpen} onClose={() => setMapOpen(false)} plan={plan} progress={progress} chunks={lesson.document.chunks} onShowStep={showStep} />

      <DocumentPanel
        open={documentOpen}
        onClose={() => setDocumentOpen(false)}
        document={lesson.document}
        plan={plan}
        progress={progress}
        onShowStep={showStep}
      />
    </div>
  );
}
