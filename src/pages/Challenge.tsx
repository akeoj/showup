import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/Button';
import { DayCalendar } from '@/components/DayCalendar';
import { Leaderboard } from '@/components/Leaderboard';
import { ManualEntry } from '@/components/ManualEntry';
import { ProgressBar } from '@/components/ProgressBar';
import { isParticipant, joinChallenge, recordWorkout } from '@/features/challenges/api';
import {
  useChallenge,
  useHistory,
  useLeaderboard,
  useTodayCount,
} from '@/features/challenges/hooks';
import { getActivity } from '@/lib/activities';
import { challengeStatus, formatRange } from '@/lib/dates';
import { useAppStore } from '@/store/appStore';

export function ChallengePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { challenge, loading, reload: reloadChallenge } = useChallenge(id);
  const { count, today, synced, reload: reloadToday } = useTodayCount(challenge);
  const { rows, error: boardError } = useLeaderboard(challenge);
  const { rows: history, reload: reloadHistory } = useHistory(id);
  const userId = useAppStore((s) => s.userId);
  const nickname = useAppStore((s) => s.nickname);

  const [member, setMember] = useState<boolean | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!id) return;
    void isParticipant(id).then(setMember);
  }, [id]);

  if (loading) {
    return (
      <AppShell title="Loading…" back="/">
        <p className="py-16 text-center text-muted">Loading challenge…</p>
      </AppShell>
    );
  }

  if (!challenge) {
    return (
      <AppShell title="Not found" back="/">
        <div className="py-16 text-center">
          <p className="text-muted">We couldn't load that challenge.</p>
          <p className="mt-1 text-sm text-muted/70">
            If you just joined, this is usually a dropped connection rather than a missing
            challenge.
          </p>
          <Button className="mt-5" variant="secondary" onClick={() => void reloadChallenge()}>
            Try again
          </Button>
        </div>
      </AppShell>
    );
  }

  const activity = getActivity(challenge.activity_type);
  const status = challengeStatus(challenge.start_date, challenge.end_date, today);
  const me = rows.find((r) => r.user_id === userId);
  const streak = me?.current_streak ?? 0;
  const rank = rows.length && me ? [...rows].findIndex((r) => r.user_id === me.user_id) + 1 : null;
  const canCount = challenge.tracking_mode === 'cv';

  const join = async () => {
    setJoining(true);
    try {
      await joinChallenge(challenge.code, nickname || 'Anonymous', challenge);
      setMember(true);
    } finally {
      setJoining(false);
    }
  };

  const saveManual = async (total: number) => {
    await recordWorkout({
      challengeId: challenge.id,
      date: today,
      count: total,
      source: 'manual',
    });
    await reloadToday();
    await reloadHistory();
  };

  return (
    <AppShell
      title={challenge.name}
      back="/"
      action={
        <Link
          to={`/challenge/${challenge.id}/manage`}
          aria-label="Challenge details"
          className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-text"
        >
          Info
        </Link>
      }
    >
      <div className="space-y-5">
        {member === false && (
          <div className="card border-flame/40 bg-flame/10">
            <p className="text-sm">You're viewing this challenge but haven't joined yet.</p>
            <Button full className="mt-3" onClick={join} loading={joining}>
              Join this challenge
            </Button>
          </div>
        )}

        {status === 'upcoming' && (
          <p className="card text-center text-sm text-muted">
            Starts {formatRange(challenge.start_date, challenge.start_date)} — logging opens then.
          </p>
        )}
        {status === 'ended' && (
          <p className="card text-center text-sm text-muted">
            This challenge finished on {formatRange(challenge.end_date, challenge.end_date)}.
          </p>
        )}

        {/* Today */}
        <section className="card">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">Today</h2>
            {streak > 0 && (
              <span className="text-sm">
                🔥 <span className="tabular font-semibold">{streak}</span> day streak
              </span>
            )}
          </div>

          <p className="mt-2 text-4xl font-bold tabular">
            {count.toLocaleString()}
            <span className="text-xl font-normal text-muted">
              {' '}
              / {challenge.daily_target.toLocaleString()}
            </span>
          </p>
          <p className="text-sm text-muted">
            {activity.emoji} {challenge.unit}
            {!synced && <span className="ml-2 text-flame">· saved on this phone</span>}
          </p>

          <div className="mt-3">
            <ProgressBar value={count} max={challenge.daily_target} label="Today's progress" />
          </div>

          {count >= challenge.daily_target && (
            <p className="mt-3 text-center text-sm font-semibold text-lime">
              Target hit for today 🎉
            </p>
          )}

          {status === 'active' && member !== false && (
            <div className="mt-4 space-y-2">
              {canCount && (
                <Button full onClick={() => navigate(`/challenge/${challenge.id}/workout`)}>
                  Start workout
                </Button>
              )}
              <Button full variant={canCount ? 'secondary' : 'primary'} onClick={() => setManualOpen(true)}>
                {canCount ? 'Log it myself' : `Log ${challenge.unit}`}
              </Button>
            </div>
          )}
        </section>

        {/* Leaderboard preview */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
              Leaderboard
            </h2>
            <Link
              to={`/challenge/${challenge.id}/leaderboard`}
              className="text-sm text-flame underline underline-offset-4"
            >
              See all
            </Link>
          </div>
          {boardError ? (
            <p className="card text-center text-sm text-muted">{boardError}</p>
          ) : (
            <Leaderboard rows={rows} unit={challenge.unit} meUserId={userId} compact />
          )}
          {rank && (
            <p className="mt-2 text-center text-sm text-muted">
              You're #{rank} of {rows.length}
            </p>
          )}
        </section>

        {/* Calendar */}
        <section className="card">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
            Your days
          </h2>
          <DayCalendar
            start={challenge.start_date}
            end={challenge.end_date}
            today={today}
            history={history}
            dailyTarget={challenge.daily_target}
          />
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-lime" /> target met
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-flame/30" /> partial
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded bg-surface2" /> nothing yet
            </span>
          </div>
          <p className="mt-3 text-sm text-muted">
            Total so far:{' '}
            <span className="tabular text-text">
              {(me?.total_count ?? history.reduce((s, h) => s + h.count, 0)).toLocaleString()}
            </span>{' '}
            {challenge.unit}
          </p>
        </section>
      </div>

      {manualOpen && (
        <ManualEntry
          unit={challenge.unit}
          currentCount={count}
          dailyTarget={challenge.daily_target}
          maxDaily={activity.maxDaily}
          onSubmit={saveManual}
          onClose={() => setManualOpen(false)}
        />
      )}
    </AppShell>
  );
}
