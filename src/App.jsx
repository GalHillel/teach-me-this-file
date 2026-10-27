import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { fetchHealth } from './api/client.js';
import AppHeader from './components/AppHeader.jsx';
import SettingsDialog from './components/SettingsDialog.jsx';
import SetupScreen, { DEFAULT_PROMPT } from './components/SetupScreen.jsx';
import { extractDocument } from './document/extract.js';
import { useI18n } from './i18n/translate.js';
import { clearLesson, loadLesson } from './lesson/storage.js';

const LessonScreen = lazy(() => import('./components/LessonScreen.jsx'));

const EMPTY_UPLOAD = { status: 'idle' };

export default function App() {
  const { t } = useI18n();
  const [settings, setSettings] = useState({ apiKey: '', provider: 'auto' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [serverKey, setServerKey] = useState(null);
  const [demo, setDemo] = useState(false);
  const [upload, setUpload] = useState(EMPTY_UPLOAD);
  const [teacherPrompt, setTeacherPrompt] = useState(DEFAULT_PROMPT);
  const [lessonLanguage, setLessonLanguage] = useState('');
  const [lesson, setLesson] = useState(loadLesson);
  const uploadRef = useRef(0);

  useEffect(() => {
    fetchHealth().then((health) => {
      setServerKey(Boolean(health.serverKey));
      setDemo(health.demo === true);
    });
  }, []);

  const keyReady = Boolean(settings.apiKey) || serverKey === true || demo || settings.provider === 'mock';
  const needsKey = !keyReady && serverKey === false;

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
      if (!error.code) console.error('file extraction failed', error);
      setUpload({ status: 'error', file: meta, error: { code: error.code ?? 'read_failed', params: error.params ?? {} } });
    }
  };

  const removeFile = () => {
    uploadRef.current += 1;
    setUpload(EMPTY_UPLOAD);
  };

  const endLesson = () => {
    clearLesson();
    setLesson(null);
  };

  const leaveLesson = () => {
    if (window.confirm(t('lesson.leaveConfirm'))) endLesson();
  };

  return (
    <div className="flex h-dvh flex-col">
      {demo && <p className="border-b border-marker-edge bg-marker-soft px-4 py-2 text-center text-sm font-medium text-ink" role="status">{t('demo.banner')}</p>}
      <AppHeader keyReady={keyReady} onOpenSettings={() => setSettingsOpen(true)} onNewLesson={lesson ? leaveLesson : null} />
      {lesson ? (
        <Suspense fallback={<p className="p-6 text-sm text-muted" role="status">{t('lesson.opening')}</p>}>
          <LessonScreen key={lesson.id} lesson={lesson} settings={settings} onOpenSettings={() => setSettingsOpen(true)} onNewLesson={endLesson} />
        </Suspense>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SetupScreen
            upload={upload}
            onFile={readFile}
            onRemoveFile={removeFile}
            teacherPrompt={teacherPrompt}
            onTeacherPromptChange={setTeacherPrompt}
            lessonLanguage={lessonLanguage}
            onLessonLanguageChange={setLessonLanguage}
            settings={settings}
            needsKey={needsKey}
            onOpenSettings={() => setSettingsOpen(true)}
            onLessonReady={setLesson}
          />
        </div>
      )}
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} serverKey={serverKey === true} onSave={setSettings} />
    </div>
  );
}
