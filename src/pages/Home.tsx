import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/Button';
import { InstallPrompt } from '@/components/InstallPrompt';
import { RestoreProgress } from '@/components/RestoreProgress';
import { TransferCode } from '@/components/TransferCode';
import { ProgressBar } from '@/components/ProgressBar';
import { getMyChallenges, getMyChallengesCached } from '@/features/challenges/api';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getActivity } from '@/lib/activities';
import type { MyChallenge } from '@/lib/types';

export function Home() {
  const [mine, setMine] = useState<MyChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTransfer, setShowTransfer] = useState(false);

  const reloadMine = useCallback(async () => {
    try {
      setMine(await getMyChallenges());
    } catch {
      /* keep whatever is already showing */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Local list first so the app opens showing your challenges, not a spinner
    // — then refresh from the server without ever blanking what is on screen.
    void (async () => {
      const cached = await getMyChallengesCached();
      if (!cancelled && cached.length) {
        setMine(cached);
        setLoading(false);
      }
      try {
        const fresh = await getMyChallenges();
        if (!cancelled) setMine(fresh);
      } catch {
        /* keep whatever is already showing */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AppShell>
      <div className="pt-6">
        <p className="text-sm font-medium uppercase tracking-widest text-flame">Showup</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight">
          Challenge yourself.
          <br />
          Challenge your people.
        </h1>
        <p className="mt-3 text-muted">
          Create a challenge. Invite your people. Show up every day.
        </p>
      </div>

      {!isSupabaseConfigured && (
        <div className="card mt-5 border-flame/40 bg-flame/10 text-sm">
          <strong className="block">Backend not configured</strong>
          Copy <code>.env.example</code> to <code>.env.local</code>, add your Supabase URL and anon
          key, then restart the dev server.
        </div>
      )}

      <div className="mt-6">
        <InstallPrompt />
      </div>

      <div className="mt-6 space-y-2.5">
        <Link to="/create" className="block">
          <Button full>Create a challenge</Button>
        </Link>
        <Link to="/join" className="block">
          <Button full variant="secondary">
            Join with a code
          </Button>
        </Link>
        <Link
          to="/explore"
          className="block py-2 text-center text-sm text-muted underline underline-offset-4"
        >
          Explore public challenges
        </Link>
      </div>

      {/*
        The recovery path for the iOS storage split: a freshly installed app
        shows nothing, and without this the only visible option is to start
        over. Offered prominently when empty, quietly once there are
        challenges to show.
      */}
      {!loading && mine.length === 0 && (
        <div className="card mt-6 border-line">
          <p className="text-sm font-medium">Used Showup in your browser already?</p>
          <p className="mt-1 text-sm text-muted">
            Apps added to the home screen start with their own storage, so your challenges don't
            carry over on their own. A transfer code brings them across.
          </p>
          <div className="mt-2">
            <RestoreProgress onDone={reloadMine} />
          </div>
        </div>
      )}

      {!loading && mine.length > 0 && (
        <section className="mt-9 mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
            Your challenges
          </h2>
          <div className="space-y-2.5">
            {mine.map((c) => {
              const activity = getActivity(c.activity_type);
              const ended = c.end_date < new Date().toISOString().slice(0, 10);
              return (
                <Link key={c.id} to={`/challenge/${c.id}`} className="card block">
                  <div className="flex items-center gap-3">
                    <span className="text-xl" aria-hidden>
                      {activity.emoji}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold">{c.name}</h3>
                      <p className="text-xs text-muted">
                        {ended ? (
                          'Finished'
                        ) : (
                          <>
                            <span className="tabular">{c.today_count.toLocaleString()}</span> /{' '}
                            {c.daily_target.toLocaleString()} {c.unit} today
                          </>
                        )}
                      </p>
                    </div>
                    {c.is_owner && (
                      <span className="rounded-full bg-surface2 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                        Organizer
                      </span>
                    )}
                  </div>
                  {!ended && (
                    <div className="mt-3">
                      <ProgressBar value={c.today_count} max={c.daily_target} />
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Always reachable: the other end of the transfer, for moving to a new
          phone or to the home-screen app. */}
      {!loading && mine.length > 0 && (
        <section className="mt-4 border-t border-line/60 pt-5">
          {showTransfer ? (
            <div>
              <p className="mb-2 text-sm text-muted">
                Enter this code in Showup on the other device. It works once, and lasts 30 minutes.
              </p>
              <TransferCode auto />
              <button
                onClick={() => setShowTransfer(false)}
                className="mt-3 w-full py-1 text-center text-sm text-muted underline underline-offset-4"
              >
                Close
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowTransfer(true)}
              className="w-full py-2 text-center text-sm text-muted underline underline-offset-4"
            >
              Move to another device
            </button>
          )}
          <RestoreProgress onDone={reloadMine} />
        </section>
      )}
    </AppShell>
  );
}
