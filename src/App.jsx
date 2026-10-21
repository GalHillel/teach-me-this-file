import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { fetchHealth } from './api/client.js';
import AppHeader from './components/AppHeader.jsx';
import SettingsDialog from './components/SettingsDialog.jsx';
import SetupScreen, { DEFAULT_PROMPT } from './components/SetupScreen.jsx';
import { extractDocument } from './document/extract.js';

const LessonScreen = lazy(() => import('./components/LessonScreen.jsx'));

const EMPTY_UPLOAD = { status: 'idle' };

export default function App() {
  const [settings, setSettings] = useState({ apiKey: '', provider: 'auto' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverKey, setServerKey] = useState(false);
  const [upload, setUpload] = useState(EMPTY_UPLOAD);
  const [teacherPrompt, setTeacherPrompt] = useState(DEFAULT_PROMPT);
  const [lesson, setLesson] = useState(null);
  const uploadRef = useRef(0);

  useEffect(() => {
    fetchHealth().then((health) => setServerKey(Boolean(health.serverKey)));
  }, []);

  const keyReady = Boolean(settings.apiKey) || serverKey || settings.provider === 'mock';

  const readFile = async (file) => {
    const id = (uploadRef.current += 1);
    const meta = { name: file.name, size: file.size };
    setUpload({ status: 'reading', file: meta, progress: 0 });
    try {
      const document = await extractDocument(file, (progress) => {
        if (uploadRef.current === id) setUpload((current) => ({ ...current, progress }));
      });
      if (uploadRef.current === id) setUpload({ status: 'ready', file: meta, document });
    } catch (error) {
      if (uploadRef.current !== id) return;
      const message = error.code ? error.message : 'This file could not be read. It may be damaged or in an unexpected format.';
      setUpload({ status: 'error', file: meta, error: message });
    }
  };

  const removeFile = () => {
    uploadRef.current += 1;
    setUpload(EMPTY_UPLOAD);
  };

  const leaveLesson = () => {
    if (window.confirm('Leave this lesson? The conversation and progress will be lost.')) setLesson(null);
  };

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader keyReady={keyReady} onOpenSettings={() => setSettingsOpen(true)} onNewLesson={lesson ? leaveLesson : null} />
      {lesson ? (
        <Suspense fallback={<p className="p-6 text-sm text-muted" role="status">Opening the lesson</p>}>
          <LessonScreen key={lesson.id} lesson={lesson} settings={settings} onOpenSettings={() => setSettingsOpen(true)} />
        </Suspense>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SetupScreen
            upload={upload}
            onFile={readFile}
            onRemoveFile={removeFile}
            teacherPrompt={teacherPrompt}
            onTeacherPromptChange={setTeacherPrompt}
            settings={settings}
            needsKey={!keyReady}
            onOpenSettings={() => setSettingsOpen(true)}
            onLessonReady={setLesson}
          />
        </div>
      )}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} serverKey={serverKey} onSave={setSettings} />
    </div>
  );
}
