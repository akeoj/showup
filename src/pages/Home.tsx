import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/Button';
import { ProgressBar } from '@/components/ProgressBar';
import { getMyChallenges } from '@/features/challenges/api';
import { isSupabaseConfigured } from '@/lib/supabase';
import { getActivity } from '@/lib/activities';
import type { MyChallenge } from '@/lib/types';

export function Home() {
  const [mine, setMine] = useState<MyChallenge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void getMyChallenges()
      .then(setMine)
      .catch(() => setMine([]))
      .finally(() => setLoading(false));
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

      <div className="mt-7 space-y-2.5">
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

      {!loading && mine.length > 0 && (
        <section className="mt-9">
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
    </AppShell>
  );
}
