import { useEffect, useState } from 'react';
import { Button } from './Button';
import { createTransferCode } from '@/features/challenges/api';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

/**
 * Shows a one-time code that carries this participant's history to another
 * install. Generated on demand — a code sitting unused is a bearer credential
 * with nothing to gain from existing early.
 */
export function TransferCode({ auto = false }: { auto?: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const t = await createTransferCode();
      setCode(t.code);
      setExpiresAt(new Date(t.expires_at).getTime());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a code.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (auto && !code && !loading && !error) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const ms = expiresAt - Date.now();
      if (ms <= 0) {
        setRemaining('expired');
        return;
      }
      const mins = Math.floor(ms / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      setRemaining(`${mins}:${String(secs).padStart(2, '0')}`);
    };
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [expiresAt]);

  if (!code) {
    return (
      <div>
        <Button variant="secondary" full onClick={generate} loading={loading}>
          Get my transfer code
        </Button>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  const expired = remaining === 'expired';

  return (
    <div className="rounded-xl border border-line bg-surface2 p-3 text-center">
      <p className="select-all font-mono text-2xl font-bold tracking-[0.2em] text-flame">{code}</p>
      <p className="mt-1 text-xs text-muted">
        {expired ? 'This code has expired.' : `Valid for ${remaining} · one use only`}
      </p>
      <div className="mt-2 flex justify-center gap-3 text-sm">
        {!expired && (
          <button
            onClick={async () => {
              if (await copyText(code)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }
            }}
            className="text-muted underline underline-offset-4"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        )}
        <button onClick={generate} className="text-muted underline underline-offset-4">
          New code
        </button>
      </div>
    </div>
  );
}
