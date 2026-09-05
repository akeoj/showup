interface Props {
  value: number;
  max: number;
  label?: string;
}

export function ProgressBar({ value, max, label }: Props) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const done = value >= max && max > 0;

  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label ?? `${value} of ${max}`}
      className="h-3 w-full overflow-hidden rounded-full bg-surface2"
    >
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${
          done ? 'bg-lime' : 'bg-flame'
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
