import { Link } from 'react-router-dom';
import { getActivity } from '@/lib/activities';
import { formatRange } from '@/lib/dates';

interface Props {
  id: string;
  name: string;
  activityType: string;
  unit: string;
  dailyTarget: number;
  startDate: string;
  endDate: string;
  participantCount?: number;
  activeToday?: number;
  creator?: string | null;
  footer?: React.ReactNode;
}

export function ChallengeCard({
  id,
  name,
  activityType,
  unit,
  dailyTarget,
  startDate,
  endDate,
  participantCount,
  activeToday,
  creator,
  footer,
}: Props) {
  const activity = getActivity(activityType);

  return (
    <Link
      to={`/challenge/${id}`}
      className="card block transition hover:border-muted/40 active:scale-[0.99]"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden>
          {activity.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{name}</h3>
          <p className="text-sm text-muted">
            {dailyTarget.toLocaleString()} {unit} a day · {formatRange(startDate, endDate)}
          </p>
          <p className="mt-1 text-xs text-muted/80">
            {participantCount !== undefined && (
              <>
                {participantCount} {participantCount === 1 ? 'person' : 'people'}
              </>
            )}
            {activeToday !== undefined && activeToday > 0 && <> · {activeToday} active today</>}
            {creator && <> · by {creator}</>}
          </p>
        </div>
      </div>
      {footer}
    </Link>
  );
}
