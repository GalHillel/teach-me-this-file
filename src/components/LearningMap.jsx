import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/translate.js';
import { nextAction, stepView } from '../lesson/progressView.js';
import { conceptInFile, stepDepths } from '../lesson/sources.js';
import Dialog from './Dialog.jsx';
import { LEVEL_STYLES } from './levels.js';

const useEdges = (containerRef, plan, open) => {
  const [edges, setEdges] = useState([]);
  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const box = container.getBoundingClientRect();
    const position = (index) => container.querySelector(`[data-map-step="${index}"]`)?.getBoundingClientRect();
    const next = [];
    plan.steps.forEach((step, index) => {
      const child = position(index);
      for (const id of step.prerequisites ?? []) {
        const parentIndex = plan.steps.findIndex((item) => item.id === id);
        const parent = parentIndex >= 0 ? position(parentIndex) : null;
        if (!child || !parent) continue;
        next.push({
          key: `${parentIndex}-${index}`,
          x1: parent.left + parent.width / 2 - box.left,
          y1: parent.bottom - box.top,
          x2: child.left + child.width / 2 - box.left,
          y2: child.top - box.top,
        });
      }
    });
    setEdges(next);
  }, [containerRef, plan.steps]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [open, measure, containerRef]);

  return edges;
};

export default function LearningMap({ open, onClose, plan, progress, chunks, onShowStep }) {
  const { t } = useI18n();
  const containerRef = useRef(null);
  const depths = useMemo(() => stepDepths(plan), [plan]);
  const rows = useMemo(() => {
    const grouped = [];
    depths.forEach((depth, index) => {
      grouped[depth] ??= [];
      grouped[depth].push(index);
    });
    return grouped.filter(Boolean);
  }, [depths]);
  const builds = useMemo(
    () => plan.steps.map((step) => (step.prerequisites ?? []).map((id) => plan.steps.findIndex((item) => item.id === id) + 1).filter((number) => number > 0)),
    [plan],
  );
  const provenance = useMemo(
    () => plan.steps.map((step) => step.keyConcepts.map((concept) => ({ concept, inFile: conceptInFile(concept, chunks) }))),
    [plan.steps, chunks],
  );
  const edges = useEdges(containerRef, plan, open);
  const next = nextAction(progress);

  return (
    <Dialog open={open} onClose={onClose} title={t('map.title')} variant="wide" labelId="map-title">
      <p className="text-sm text-muted">{t('map.intro')}</p>
      <p className="mt-3 rounded-lg bg-pen-soft/60 px-3 py-2 text-sm" data-next-action={next.code}>
        <span className="font-semibold">{t('map.next')}</span>
        {' '}
        {t(`next.${next.code}`, next)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>{t('map.legend')}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded-full border border-line bg-paper px-2 py-0.5 text-ink">Aa</span>
          {t('map.inFile')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded-full border border-dashed border-muted px-2 py-0.5">Aa</span>
          {t('map.inferred')}
        </span>
      </div>

      <div ref={containerRef} className="relative mt-5">
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true">
          <defs>
            <marker id="map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 10 5 0 10z" fill="var(--color-muted)" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const middle = (edge.y1 + edge.y2) / 2;
            return (
              <path
                key={edge.key}
                d={`M${edge.x1} ${edge.y1} C${edge.x1} ${middle} ${edge.x2} ${middle} ${edge.x2} ${edge.y2 - 2}`}
                fill="none"
                stroke="var(--color-muted)"
                strokeWidth="1.4"
                strokeDasharray="4 3"
                markerEnd="url(#map-arrow)"
              />
            );
          })}
        </svg>
        <ol className="relative space-y-8">
          {rows.map((row) => (
            <li key={row.join('-')} className="flex flex-wrap justify-center gap-4">
              {row.map((index) => {
                const step = plan.steps[index];
                const { display: level, basis, state } = stepView(progress, index);
                const style = LEVEL_STYLES[level];
                const reachable = progress.steps[index].status !== 'pending';
                return (
                  <div key={step.id} data-map-step={index} className={`w-full max-w-[17rem] rounded-xl border bg-surface p-3 shadow-sm ${style.border}`}>
                    <div className="flex items-start gap-2">
                      <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${style.marker}`}>{index + 1}</span>
                      <div className="min-w-0">
                        <p dir="auto" className="text-sm font-medium leading-snug">{step.title}</p>
                        <p className="mt-0.5 text-xs text-muted" data-state={state}>{t(`level.${level}`)}</p>
                        {progress.steps[index].status !== 'pending' && basis !== 'no_answers' && <p className="mt-0.5 text-xs text-ink">{t(`basis.${basis}`)}</p>}
                        {builds[index].length > 0 && <p className="mt-0.5 text-xs text-muted">{t('map.buildsOn', { steps: builds[index].join(', ') })}</p>}
                      </div>
                    </div>
                    {provenance[index].length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1">
                        {provenance[index].map(({ concept, inFile }) => (
                          <li
                            key={concept}
                            dir="auto"
                            title={inFile ? t('map.inFile') : t('map.inferred')}
                            className={`rounded-full px-2 py-0.5 text-xs ${inFile ? 'border border-line bg-paper' : 'border border-dashed border-muted text-muted'}`}
                          >
                            {concept}
                            <span className="sr-only">{`, ${inFile ? t('map.inFile') : t('map.inferred')}`}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {reachable && (
                      <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-pen hover:underline" onClick={() => onShowStep(index)}>
                        {t('plan.goToStep', { count: index + 1 })}
                      </button>
                    )}
                  </div>
                );
              })}
            </li>
          ))}
        </ol>
      </div>
    </Dialog>
  );
}
