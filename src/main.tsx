import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './app/router';
import { startSyncManager } from './lib/sync';
import { useAppStore } from './store/appStore';
import './index.css';

function Boot() {
  const init = useAppStore((s) => s.init);
  const ready = useAppStore((s) => s.ready);

  useEffect(() => {
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

  return <AppRouter />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boot />
  </StrictMode>,
);
