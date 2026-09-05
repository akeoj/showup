import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/Button';
import { ProgressBar } from '@/components/ProgressBar';
import { VideoResult } from '@/components/VideoResult';
import { useChallenge, useLeaderboard, useSyncStatus } from '@/features/challenges/hooks';
import { useAppStore } from '@/store/appStore';

export function Results() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { challenge } = useChallenge(id);
  const result = useAppStore((s) => s.lastResult);
  const clip = useAppStore((s) => s.lastClip);
  const setLastClip = useAppStore((s) => s.setLastClip);
  const userId = useAppStore((s) => s.userId);
  const { rows } = useLeaderboard(challenge);
  const sync = useSyncStatus();

  if (!challenge || !result || result.challengeId !== challenge.id) {
    return (
      <AppShell title="Workout" back={`/challenge/${id}`}>
        <p className="py-16 text-center text-muted">Nothing to show — start a workout first.</p>
      </AppShell>
    );
  }

  const met = result.total >= result.target;
  const remaining = Math.max(0, result.target - result.total);
  const me = rows.find((r) => r.user_id === userId);

  return (
    <AppShell title="Workout complete" back={`/challenge/${challenge.id}`}>
      <div className="space-y-5 pt-4 text-center">
        <p className="text-5xl" aria-hidden>
          {met ? '🎉' : '💪'}
        </p>

        <div>
          <p className="text-6xl font-bold tabular">{result.count.toLocaleString()}</p>
          <p className="text-muted">
            {challenge.unit} this session
          </p>
        </div>

        <div className="card text-left">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm text-muted">Today</span>
            <span className="tabular">
              {result.total.toLocaleString()} / {result.target.toLocaleString()}
            </span>
          </div>
          <ProgressBar value={result.total} max={result.target} />
          <p className="mt-3 text-sm text-muted">
            {met
              ? 'Daily target reached. Day counted towards your streak.'
              : `${remaining.toLocaleString()} ${challenge.unit} left to complete today.`}
          </p>
        </div>

        {clip && (
          <VideoResult
            clip={clip}
            challengeName={challenge.name}
            reps={result.count}
            onDiscard={() => setLastClip(null)}
          />
        )}

        {me && me.current_streak > 0 && (
          <p className="text-lg">
            🔥 <span className="tabular font-semibold">{me.current_streak}</span> day streak
          </p>
        )}

        <p className="text-sm text-muted">
          {sync.pending > 0
            ? 'Saved on this phone — it will sync as soon as you have a connection.'
            : 'Saved and synced.'}
        </p>

        <div className="space-y-2 pt-2">
          <Button full onClick={() => navigate(`/challenge/${challenge.id}`)}>
            Done
          </Button>
          {!met && challenge.tracking_mode === 'cv' && (
            <Button
              full
              variant="secondary"
              onClick={() => navigate(`/challenge/${challenge.id}/workout`)}
            >
              Keep going
            </Button>
          )}
          <Button
            full
            variant="ghost"
            onClick={() => navigate(`/challenge/${challenge.id}/leaderboard`)}
          >
            See the leaderboard
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
