import { useMemo, useState } from 'react';
import { localizeLabel, useI18n } from '../i18n/translate.js';
import { highlightPassage, readableText, searchPassages } from '../lesson/sources.js';
import Dialog from './Dialog.jsx';

const SNIPPET_LENGTH = 260;

const snippet = (text) => (text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH).replace(/\s+\S*$/, '')}…` : text);

function Result({ chunk, query, stepInfo, onShowStep }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const text = readableText(chunk.text);
  const shown = open ? text : snippet(text);
  return (
    <li className="rounded-xl border border-line bg-surface p-3.5">
      <p className="text-xs font-medium text-muted">
        {localizeLabel(chunk.label, t)}
        {chunk.section && <span dir="auto"> · {chunk.section}</span>}
      </p>
      <p dir="auto" className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">
        {highlightPassage(shown, query).map((part) => (part.hit ? <mark key={part.key} className="marker">{part.text}</mark> : part.text))}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {text.length > SNIPPET_LENGTH && (
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? t('doc.showLess') : t('doc.showMore')}
          </button>
        )}
        {stepInfo && (stepInfo.reached ? (
          <button type="button" className="btn-secondary px-2.5 py-1 text-xs" onClick={() => onShowStep(stepInfo.index)}>
            {t('doc.taughtIn', { step: stepInfo.index + 1 })}
          </button>
        ) : (
          <span className="text-xs text-muted">{t('doc.comesIn', { step: stepInfo.index + 1 })}</span>
        ))}
      </div>
    </li>
  );
}

export default function DocumentPanel({ open, onClose, document, plan, progress, onShowStep }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');

  const concepts = useMemo(() => [...new Set(plan.steps.flatMap((step) => step.keyConcepts))].slice(0, 14), [plan.steps]);
  const stepOfChunk = useMemo(() => {
    const map = new Map();
    plan.steps.forEach((step, index) => step.sourceIds.forEach((id) => {
      if (!map.has(id)) map.set(id, index);
    }));
    return map;
  }, [plan.steps]);
  const sections = useMemo(() => {
    const first = new Map();
    for (const chunk of document.chunks) {
      if (chunk.section && !first.has(chunk.section)) first.set(chunk.section, chunk);
    }
    return [...first.values()];
  }, [document.chunks]);

  const results = query.trim() ? searchPassages(query, document.chunks) : sections.length ? sections : document.chunks.slice(0, 6);
  const infoFor = (chunk) => {
    const index = stepOfChunk.get(chunk.id);
    if (index === undefined) return null;
    return { index, reached: progress.steps[index].status !== 'pending' };
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('doc.title')} variant="side" labelId="document-title">
      <div className="space-y-4">
        <div>
          <label htmlFor="document-search" className="sr-only">{t('doc.placeholder')}</label>
          <input
            id="document-search"
            type="search"
            dir="auto"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('doc.placeholder')}
            className="field"
            autoComplete="off"
          />
        </div>

        {concepts.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t('doc.concepts')}</h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {concepts.map((concept) => (
                <button
                  key={concept}
                  type="button"
                  dir="auto"
                  onClick={() => setQuery(concept)}
                  aria-pressed={query === concept}
                  className={`min-h-8 rounded-full border px-3 py-1 text-sm ${query === concept ? 'border-pen bg-pen-soft text-pen' : 'border-line bg-surface hover:border-pen hover:text-pen'}`}
                >
                  {concept}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted" aria-live="polite">
            {query.trim() ? t('doc.results', { count: results.length }) : sections.length ? t('doc.sections') : t('doc.start')}
          </h3>
          {results.length ? (
            <ul className="mt-2 space-y-2.5">
              {results.map((chunk) => (
                <Result key={chunk.id} chunk={chunk} query={query} stepInfo={infoFor(chunk)} onShowStep={onShowStep} />
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">{t('doc.noResults')}</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
