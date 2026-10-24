import { languageName, useI18n } from '../i18n/translate.js';
import Icon from './Icon.jsx';

const NEEDS_REVIEW = new Set(['recovered', 'review']);

function StepMarker({ state, index }) {
  if (state.status === 'done') {
    const review = NEEDS_REVIEW.has(state.outcome);
    return (
      <span className={`grid size-6 shrink-0 place-items-center rounded-full ${review ? 'bg-marker text-ink' : 'bg-success text-white'}`}>
        {review ? <span className="text-xs font-semibold">!</span> : <Icon name="check" className="size-3.5" />}
      </span>
    );
  }
  return (
    <span className={`grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium ${state.status === 'active' ? 'border-pen bg-pen text-white' : 'border-line bg-surface text-muted'}`}>
      {index + 1}
    </span>
  );
}

export default function LessonPlanPanel({ plan, progress, onSelectStep }) {
  const { t, language } = useI18n();
  const done = progress.steps.filter((step) => step.status === 'done').length;
  return (
    <div className="space-y-6">
      <div className="space-y-1 text-sm text-muted">
        <p>
          {plan.audience && <bdi>{plan.audience}</bdi>}
          {plan.audience ? ', ' : ''}
          {t('plan.minutes', { minutes: plan.durationMinutes })}
        </p>
        <p>{t('plan.language', { language: languageName(plan.languageCode, language) })}</p>
        <p>{t('plan.done', { done, total: plan.steps.length })}</p>
      </div>

      {(plan.warnings ?? []).map((warning) => (
        <p key={warning} className="flex gap-2 rounded-lg bg-marker-soft px-3 py-2 text-sm">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-muted" />
          <span>{t(`plan.warning.${warning}`)}</span>
        </p>
      ))}

      {plan.objectives.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">{t('plan.goals')}</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-muted">
            {plan.objectives.map((objective) => (
              <li key={objective} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-muted" aria-hidden="true" />
                <span dir="auto">{objective}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold">{t('plan.steps')}</h3>
        <ol className="mt-3 space-y-1">
          {plan.steps.map((step, index) => {
            const state = progress.steps[index];
            const active = (state.status === 'active' && progress.status === 'active') || (progress.status === 'reviewing' && progress.review.queue[progress.review.position] === index);
            const reachable = state.status !== 'pending' && onSelectStep;
            const content = (
              <>
                <StepMarker state={state} index={index} />
                <span className="min-w-0 text-start">
                  <span dir="auto" className={`block text-sm leading-snug ${state.status === 'pending' ? 'text-muted' : 'font-medium text-ink'}`}>{step.title}</span>
                  {active && state.attempts > 0 && (
                    <span className="mt-0.5 block text-xs text-muted">{t('plan.attempt', { count: state.attempts + 1 })}</span>
                  )}
                  {state.outcome && <span className="mt-0.5 block text-xs text-muted">{t(`outcome.${state.outcome}`)}</span>}
                  {progress.review?.results?.[index] && (
                    <span className="mt-0.5 block text-xs text-muted">{t('plan.reviewed', { result: t(`reviewResult.${progress.review.results[index]}`) })}</span>
                  )}
                </span>
              </>
            );
            return (
              <li key={step.id} aria-current={active ? 'step' : undefined}>
                {reachable ? (
                  <button
                    type="button"
                    onClick={() => onSelectStep(index)}
                    title={t('plan.goToStep', { count: index + 1 })}
                    className={`flex w-full gap-3 rounded-lg px-2 py-2 hover:bg-rule ${active ? 'bg-marker-soft' : ''}`}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="flex gap-3 rounded-lg px-2 py-2">{content}</div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {plan.notes && (
        <p className="flex gap-2 rounded-lg bg-marker-soft px-3 py-2 text-sm" dir="auto">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-muted" />
          <span>{plan.notes}</span>
        </p>
      )}
    </div>
  );
}
