import { useParams } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Leaderboard } from '@/components/Leaderboard';
import { useChallenge, useLeaderboard } from '@/features/challenges/hooks';
import { useAppStore } from '@/store/appStore';

export function LeaderboardPage() {
  const { id } = useParams();
  const { challenge } = useChallenge(id);
  const { rows, loading, error } = useLeaderboard(challenge);
  const userId = useAppStore((s) => s.userId);

  return (
    <AppShell title="Leaderboard" back={`/challenge/${id}`}>
      {challenge && (
        <p className="mb-4 text-sm text-muted">
          {challenge.name} · {challenge.daily_target.toLocaleString()} {challenge.unit} a day
        </p>
      )}

      {loading && <p className="py-10 text-center text-muted">Loading…</p>}
      {error && !loading && <p className="card text-center text-sm text-muted">{error}</p>}

      {!loading && !error && challenge && (
        <Leaderboard rows={rows} unit={challenge.unit} meUserId={userId} defaultMetric="total" />
      )}

      <p className="mt-6 text-center text-xs text-muted/70">
        Ranked by the selected metric, then total, then longest streak. Updates live as people log.
      </p>
    </AppShell>
  );
}
