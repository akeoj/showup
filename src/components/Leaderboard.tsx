import { useState } from 'react';
import type { LeaderboardRow } from '@/lib/types';

export type BoardMetric = 'today' | 'total' | 'streak' | 'days';

const MEDALS = ['🥇', '🥈', '🥉'];

const TABS: { id: BoardMetric; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'total', label: 'Total' },
  { id: 'streak', label: 'Streak' },
  { id: 'days', label: 'Days done' },
];

function valueOf(row: LeaderboardRow, metric: BoardMetric): number {
  switch (metric) {
    case 'today':
      return row.today_count;
    case 'total':
      return row.total_count;
    case 'streak':
      return row.longest_streak;
    case 'days':
      return row.completed_days;
  }
}

function suffix(metric: BoardMetric, unit: string): string {
  if (metric === 'streak') return 'days';
  if (metric === 'days') return 'days';
  return unit;
}

/**
 * Ranking rules, stated once so they are the same everywhere:
 *  - sort descending by the selected metric
 *  - ties break on total, then on longest streak, then alphabetically
 *  - tied rows share a rank number (1, 2, 2, 4)
 */
export function sortRows(rows: LeaderboardRow[], metric: BoardMetric): LeaderboardRow[] {
  return [...rows].sort(
    (a, b) =>
      valueOf(b, metric) - valueOf(a, metric) ||
      b.total_count - a.total_count ||
      b.longest_streak - a.longest_streak ||
      a.nickname.localeCompare(b.nickname),
  );
}

interface Props {
  rows: LeaderboardRow[];
  unit: string;
  meUserId?: string | null;
  defaultMetric?: BoardMetric;
  compact?: boolean;
}

export function Leaderboard({ rows, unit, meUserId, defaultMetric = 'today', compact }: Props) {
  const [metric, setMetric] = useState<BoardMetric>(defaultMetric);
  const sorted = sortRows(rows, metric);
  const visible = compact ? sorted.slice(0, 5) : sorted;

  let lastValue: number | null = null;
  let lastRank = 0;

  return (
    <div>
      {!compact && (
        <div role="tablist" className="mb-3 flex gap-1 rounded-xl bg-surface2 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={metric === t.id}
              onClick={() => setMetric(t.id)}
              className={`flex-1 rounded-lg px-2 py-2 text-sm transition ${
                metric === t.id ? 'bg-flame text-ink font-semibold' : 'text-muted'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 && (
        <p className="py-6 text-center text-sm text-muted">
          No one has logged anything yet. Be first.
        </p>
      )}

      <ol className="space-y-1.5">
        {visible.map((row, i) => {
          const value = valueOf(row, metric);
          const rank = value === lastValue ? lastRank : i + 1;
          lastValue = value;
          lastRank = rank;
          const isMe = meUserId && row.user_id === meUserId;

          return (
            <li
              key={row.user_id}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                isMe ? 'bg-flame/10 ring-1 ring-flame/30' : 'bg-surface'
              }`}
            >
              <span className="w-7 shrink-0 text-center text-sm tabular text-muted">
                {rank <= 3 ? MEDALS[rank - 1] : rank}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {row.nickname}
                {isMe && <span className="ml-1.5 text-xs text-flame">you</span>}
              </span>
              {metric !== 'streak' && row.current_streak > 0 && (
                <span className="shrink-0 text-xs text-muted" title="Current streak">
                  🔥{row.current_streak}
                </span>
              )}
              <span className="shrink-0 tabular font-semibold">
                {value.toLocaleString()}
                <span className="ml-1 text-xs font-normal text-muted">
                  {suffix(metric, unit)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
