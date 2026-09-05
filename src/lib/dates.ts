/**
 * Every date in this app is a *challenge-local* calendar date. A participant in
 * Lagos and one in London logging at 23:30 must land on the same day only if
 * the challenge says so — so "today" is always derived from the challenge's
 * timezone, never from the device clock's zone.
 */

export function todayInZone(timeZone: string, at: Date = new Date()): string {
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly the shape Postgres wants.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  }
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function formatShortDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function formatRange(start: string, end: string): string {
  return `${formatShortDate(start)} – ${formatShortDate(end)}`;
}

/** Inclusive list of every date in the challenge window, oldest first. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (daysBetween(cur, end) >= 0 && guard++ < 400) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

export function challengeStatus(
  start: string,
  end: string,
  today: string,
): 'upcoming' | 'active' | 'ended' {
  if (daysBetween(today, start) > 0) return 'upcoming';
  if (daysBetween(end, today) > 0) return 'ended';
  return 'active';
}

export const DEVICE_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lagos';
