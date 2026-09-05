import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './app/router';
import { UpdatePrompt } from './components/UpdatePrompt';
import { startSyncManager } from './lib/sync';
import { requestPersistentStorage } from './lib/storage';
import { useAppStore } from './store/appStore';
import './index.css';

function Boot() {
  const init = useAppStore((s) => s.init);
  const ready = useAppStore((s) => s.ready);

  useEffect(() => {
    // Ask the browser not to evict our IndexedDB. Without this, Safari clears
    // the participant's workouts (and identity) after about a week idle.
    void requestPersistentStorage();
    void init();
    startSyncManager();
  }, [init]);

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted">Showup…</p>
      </div>
    );
  }

  return (
    <>
      <AppRouter />
      <UpdatePrompt />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
