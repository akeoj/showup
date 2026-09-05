import { dateRange, formatShortDate } from '@/lib/dates';
import type { HistoryRow } from '@/lib/types';

interface Props {
  start: string;
  end: string;
  today: string;
  history: HistoryRow[];
  dailyTarget: number;
}

export function DayCalendar({ start, end, today, history, dailyTarget }: Props) {
  const byDate = new Map(history.map((h) => [h.workout_date, h]));
  const days = dateRange(start, end);

  return (
    <div className="grid grid-cols-7 gap-1.5" role="list" aria-label="Daily history">
      {days.map((d) => {
        const row = byDate.get(d);
        const count = row?.count ?? 0;
        const met = count >= dailyTarget && dailyTarget > 0;
        const partial = count > 0 && !met;
        const future = d > today;
        const isToday = d === today;

        return (
          <div
            key={d}
            role="listitem"
            title={`${formatShortDate(d)} — ${count.toLocaleString()} / ${dailyTarget.toLocaleString()}`}
            aria-label={`${formatShortDate(d)}: ${count} of ${dailyTarget}${met ? ', target met' : ''}`}
            className={`flex aspect-square items-center justify-center rounded-lg text-[11px] tabular
              ${future ? 'bg-surface2/40 text-muted/40' : ''}
              ${!future && met ? 'bg-lime text-ink font-semibold' : ''}
              ${!future && partial ? 'bg-flame/30 text-text' : ''}
              ${!future && count === 0 ? 'bg-surface2 text-muted/60' : ''}
              ${isToday ? 'ring-2 ring-flame' : ''}`}
          >
            {Number(d.slice(8, 10))}
          </div>
        );
      })}
    </div>
  );
}
