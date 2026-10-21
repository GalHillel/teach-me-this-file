import { useRef, useState } from 'react';
import { ACCEPTED_EXTENSIONS, FILE_TYPES, MAX_FILE_BYTES, detectFileType, formatBytes } from '../document/extract.js';
import Icon from './Icon.jsx';

function FileStatus({ upload }) {
  if (upload.status === 'reading') {
    const percent = Math.round((upload.progress ?? 0) * 100);
    return (
      <div className="mt-3">
        <p className="text-sm text-muted" role="status">Reading the file{percent > 0 ? ` (${percent}%)` : ''}</p>
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
        <span>{upload.error}</span>
      </p>
    );
  }
  const { document } = upload;
  const parts = [
    document.pageCount ? `${document.pageCount} page${document.pageCount > 1 ? 's' : ''}` : null,
    `${document.chunks.length} passage${document.chunks.length > 1 ? 's' : ''}`,
    `${Math.round(document.charCount / 1000) || '<1'}k characters`,
    document.direction === 'rtl' ? 'right-to-left text' : null,
  ].filter(Boolean);

  return (
    <div className="mt-3 space-y-2" role="status">
      <p className="flex items-center gap-1.5 text-sm text-success">
        <Icon name="check" className="size-4" />
        Ready: {parts.join(', ')}
      </p>
      {document.warnings.map((warning) => (
        <p key={warning} className="flex gap-2 rounded-lg bg-marker-soft px-3 py-2 text-sm text-ink">
          <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-muted" />
          <span>{warning}</span>
        </p>
      ))}
    </div>
  );
}

export default function FileDrop({ upload, onFile, onRemove }) {
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
              {type ? FILE_TYPES[type].label : 'Unknown type'}, {formatBytes(upload.file.size)}
            </p>
          </div>
          <div className="flex shrink-0 gap-1">
            <button type="button" onClick={choose} className="btn-ghost px-2.5 py-1.5" disabled={upload.status === 'reading'}>Replace</button>
            <button type="button" onClick={onRemove} className="btn-ghost px-2.5 py-1.5" aria-label={`Remove ${upload.file.name}`}>
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
          <span className="block font-medium">{dragging ? 'Drop the file here' : 'Drop a file here, or choose one'}</span>
          <span className="mt-1 block text-sm text-muted">PDF with selectable text, Word (.docx), or text (.txt, .md). Up to {formatBytes(MAX_FILE_BYTES)}.</span>
        </span>
      </button>
      {input}
    </div>
  );
}
