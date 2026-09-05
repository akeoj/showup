import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { ShareChallenge } from '@/components/ShareChallenge';
import { getParticipants } from '@/features/challenges/api';
import { useChallenge, useLeaderboard } from '@/features/challenges/hooks';
import { getActivity } from '@/lib/activities';
import { formatRange } from '@/lib/dates';
import type { Participant } from '@/lib/types';

export function Manage() {
  const { id } = useParams();
  const { challenge } = useChallenge(id);
  const { rows } = useLeaderboard(challenge);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getParticipants(id)
      .then(setParticipants)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (!challenge) {
    return (
      <AppShell title="Challenge" back={`/challenge/${id}`}>
        <p className="py-16 text-center text-muted">Loading…</p>
      </AppShell>
    );
  }

  const activity = getActivity(challenge.activity_type);
  const activeToday = rows.filter((r) => r.today_count > 0).length;
  const completedToday = rows.filter((r) => r.today_count >= challenge.daily_target).length;
  const totalLogged = rows.reduce((s, r) => s + r.total_count, 0);

  return (
    <AppShell title="Challenge details" back={`/challenge/${challenge.id}`}>
      <div className="space-y-5">
        <section className="card">
          <h2 className="text-lg font-semibold">
            {activity.emoji} {challenge.name}
          </h2>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="Activity" value={activity.label} />
            <Row
              label="Daily target"
              value={`${challenge.daily_target.toLocaleString()} ${challenge.unit}`}
            />
            <Row label="Runs" value={formatRange(challenge.start_date, challenge.end_date)} />
            <Row label="Day resets in" value={challenge.timezone.replace('_', ' ')} />
            <Row
              label="Visibility"
              value={challenge.visibility === 'public' ? 'Public — listed in Explore' : 'Private — code only'}
            />
            <Row
              label="Counting"
              value={challenge.tracking_mode === 'cv' ? 'Camera + manual' : 'Self-reported'}
            />
          </dl>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
            Activity
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Participants" value={participants.length || rows.length} />
            <Stat label="Logged today" value={activeToday} />
            <Stat label="Hit target today" value={completedToday} />
            <Stat label={`Total ${challenge.unit}`} value={totalLogged} />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">Invite</h2>
          <ShareChallenge
            name={challenge.name}
            code={challenge.code}
            dailyTarget={challenge.daily_target}
            unit={challenge.unit}
          />
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
            Participants
          </h2>
          {error && <p className="card text-sm text-muted">{error}</p>}
          <ul className="space-y-1.5">
            {participants.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-xl bg-surface px-3 py-2.5">
                <span className="truncate">{p.nickname}</span>
                <span className="shrink-0 text-xs text-muted">
                  joined {new Date(p.joined_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card">
      <p className="text-2xl font-bold tabular">{value.toLocaleString()}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}
