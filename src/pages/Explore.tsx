import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ChallengeCard } from '@/components/ChallengeCard';
import { getPublicChallenges } from '@/features/challenges/api';
import type { PublicChallenge } from '@/lib/types';

const FILTERS = [
  { id: 'trending', label: 'Trending' },
  { id: 'new', label: 'New' },
  { id: 'most_active', label: 'Most active' },
  { id: 'ending_soon', label: 'Ending soon' },
] as const;

type Filter = (typeof FILTERS)[number]['id'];

export function Explore() {
  const [filter, setFilter] = useState<Filter>('trending');
  const [rows, setRows] = useState<PublicChallenge[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getPublicChallenges(filter)
      .then((r) => {
        setRows(r);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [filter]);

  const visible = query
    ? rows.filter((r) => r.name.toLowerCase().includes(query.toLowerCase()))
    : rows;

  return (
    <AppShell title="Explore" back="/">
      <input
        className="input mb-3"
        placeholder="Search public challenges"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search public challenges"
      />

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={`shrink-0 rounded-full px-4 py-2 text-sm transition ${
              filter === f.id ? 'bg-flame font-semibold text-ink' : 'bg-surface2 text-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <p className="py-10 text-center text-muted">Loading…</p>}
      {error && !loading && <p className="py-10 text-center text-sm text-muted">{error}</p>}

      {!loading && !error && visible.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-muted">No public challenges yet.</p>
          <p className="mt-1 text-sm text-muted/70">Create one and make it public.</p>
        </div>
      )}

      <div className="space-y-2.5">
        {visible.map((c) => (
          <ChallengeCard
            key={c.id}
            id={c.id}
            name={c.name}
            activityType={c.activity_type}
            unit={c.unit}
            dailyTarget={c.daily_target}
            startDate={c.start_date}
            endDate={c.end_date}
            participantCount={c.participant_count}
            activeToday={c.active_today}
            creator={c.creator_nickname}
          />
        ))}
      </div>
    </AppShell>
  );
}
