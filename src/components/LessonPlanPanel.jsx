import Icon from './Icon.jsx';

const OUTCOME_LABELS = {
  mastered: 'Understood first try',
  learned: 'Understood after hints',
  revealed: 'Answer shown, worth reviewing',
};

function StepMarker({ state, index }) {
  if (state.status === 'done') {
    const revealed = state.outcome === 'revealed';
    return (
      <span className={`grid size-6 shrink-0 place-items-center rounded-full ${revealed ? 'bg-marker text-ink' : 'bg-success text-white'}`}>
        {revealed ? <span className="text-xs font-semibold">!</span> : <Icon name="check" className="size-3.5" />}
      </span>
    );
  }
  return (
    <span className={`grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium ${state.status === 'active' ? 'border-pen bg-pen text-white' : 'border-line bg-surface text-muted'}`}>
      {index + 1}
    </span>
  );
}

export default function LessonPlanPanel({ plan, progress }) {
  const done = progress.steps.filter((step) => step.status === 'done').length;
  return (
    <div dir={plan.direction} className="space-y-6">
      <div>
        <p className="text-sm text-muted" dir="ltr">
          {plan.audience ? `${plan.audience}, ` : ''}about {plan.durationMinutes} min
        </p>
        <p className="mt-1 text-sm text-muted" dir="ltr">{done} of {plan.steps.length} steps done</p>
      </div>

      {plan.objectives.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold" dir="ltr">Learning goals</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-muted">
            {plan.objectives.map((objective) => (
              <li key={objective} className="flex gap-2">
                <span className="mt-2 size-1 shrink-0 rounded-full bg-muted" aria-hidden="true" />
                <span>{objective}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold" dir="ltr">Steps</h3>
        <ol className="mt-3 space-y-1">
          {plan.steps.map((step, index) => {
            const state = progress.steps[index];
            const active = state.status === 'active' && progress.status === 'active';
            return (
              <li key={step.id} aria-current={active ? 'step' : undefined} className={`flex gap-3 rounded-lg px-2 py-2 ${active ? 'bg-marker-soft' : ''}`}>
                <StepMarker state={state} index={index} />
                <div className="min-w-0">
                  <p className={`text-sm leading-snug ${state.status === 'pending' ? 'text-muted' : 'font-medium text-ink'}`}>{step.title}</p>
                  {active && state.attempts > 0 && (
                    <p className="mt-0.5 text-xs text-muted" dir="ltr">Attempt {state.attempts + 1}</p>
                  )}
                  {state.outcome && <p className="mt-0.5 text-xs text-muted" dir="ltr">{OUTCOME_LABELS[state.outcome]}</p>}
                </div>
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
