import { useRef, useState } from 'react';
import { ACCEPTED_EXTENSIONS, FILE_TYPES, MAX_FILE_BYTES, detectFileType, formatBytes } from '../document/extract.js';
import { localizeLabel, useI18n } from '../i18n/translate.js';
import Icon from './Icon.jsx';

const warningText = (warning, t) => {
  if (typeof warning === 'string') return warning;
  const params = warning.code === 'long' ? { ...warning.params, label: localizeLabel(warning.params.label, t) } : warning.params;
  return t(`fileWarnings.${warning.code}`, params);
};

function FileStatus({ upload }) {
  const { t, language } = useI18n();
  if (upload.status === 'reading') {
    const percent = Math.round((upload.progress ?? 0) * 100);
    return (
      <div className="mt-3">
        <p className="text-sm text-muted" role="status">{percent > 0 ? t('file.readingPercent', { percent }) : t('file.reading')}</p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-rule">
          <div className="h-full rounded-full bg-pen transition-[width]" style={{ width: `${Math.max(percent, 8)}%` }} />
        </div>
      </div>
    );
  }
  if (upload.status === 'error') {
    return (
      <p className="mt-3 flex gap-2 text-sm text-danger" role="alert">
        <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
        <span>{t(`fileErrors.${upload.error.code}`, upload.error.params, t('fileErrors.read_failed'))}</span>
      </p>
    );
  }
  const { document } = upload;
  const number = new Intl.NumberFormat(language);
  const parts = [
    document.pageCount ? t('file.pages', { count: document.pageCount }) : null,
    t('file.passages', { count: document.chunks.length }),
    document.sectionCount ? t('file.sections', { count: document.sectionCount }) : null,
    t('file.chars', { count: number.format(document.charCount) }),
    document.direction === 'rtl' ? t('file.rtl') : null,
  ].filter(Boolean);

  return (
    <div className="mt-3 space-y-2" role="status">
      <p className="flex items-center gap-1.5 text-sm text-success">
        <Icon name="check" className="size-4" />
        {t('file.ready', { details: parts.join(', ') })}
      </p>
      {document.warnings.map((warning) => (
        <p key={warning.code ?? warning} className="flex gap-2 rounded-lg bg-marker-soft px-3 py-2 text-sm text-ink">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-muted" />
          <span>{warningText(warning, t)}</span>
        </p>
      ))}
    </div>
  );
}

export default function FileDrop({ upload, onFile, onRemove }) {
  const { t } = useI18n();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const choose = () => inputRef.current?.click();
  const handleFiles = (files) => {
    if (files?.[0]) onFile(files[0]);
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPTED_EXTENSIONS.join(',')}
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => {
        handleFiles(event.target.files);
        event.target.value = '';
      }}
    />
  );

  const dropProps = {
    onDragOver: (event) => {
      event.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event) => {
      event.preventDefault();
      setDragging(false);
      handleFiles(event.dataTransfer.files);
    },
  };

  if (upload.status !== 'idle') {
    const type = detectFileType(upload.file.name);
    return (
      <div {...dropProps} className={`rounded-xl border bg-surface p-4 transition-colors ${dragging ? 'border-pen ring-2 ring-pen/20' : 'border-line'}`}>
        <div className="flex items-start gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-lg bg-pen-soft text-pen">
            <Icon name="file" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={upload.file.name} dir="auto">{upload.file.name}</p>
            <p className="text-sm text-muted">
              {type ? FILE_TYPES[type].label : t('file.unknownType')}, {formatBytes(upload.file.size)}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <button type="button" onClick={choose} className="btn-ghost px-2.5 py-1.5" disabled={upload.status === 'reading'}>{t('file.replace')}</button>
            <button type="button" onClick={onRemove} className="btn-ghost px-2.5 py-1.5" aria-label={t('file.remove', { name: upload.file.name })}>
              <Icon name="close" className="size-4.5" />
            </button>
          </div>
        </div>
        <FileStatus upload={upload} />
        {input}
      </div>
    );
  }

  return (
    <div
      {...dropProps}
      className={`rounded-xl border-2 border-dashed transition-colors ${dragging ? 'border-pen bg-pen-soft' : 'border-line bg-surface'}`}
    >
      <button type="button" onClick={choose} className="flex w-full flex-col items-center gap-3 rounded-xl px-6 py-10 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-pen-soft text-pen">
          <Icon name="upload" className="size-6" />
        </span>
        <span>
          <span className="block font-medium">{dragging ? t('file.dropHere') : t('file.choose')}</span>
          <span className="mt-1 block text-sm text-muted">{t('file.types', { size: formatBytes(MAX_FILE_BYTES) })}</span>
        </span>
      </button>
      {input}
    </div>
  );
}
