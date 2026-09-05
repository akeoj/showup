import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/Button';
import { ShareChallenge } from '@/components/ShareChallenge';
import { createChallenge } from '@/features/challenges/api';
import { ACTIVITIES, getActivity } from '@/lib/activities';
import { addDays, DEVICE_TIMEZONE, todayInZone } from '@/lib/dates';
import { useAppStore } from '@/store/appStore';
import type { Challenge, Visibility } from '@/lib/types';

const TIMEZONES = [
  'Africa/Lagos',
  'Africa/Accra',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Europe/London',
  'America/New_York',
  'Asia/Dubai',
];

export function CreateChallenge() {
  const navigate = useNavigate();
  const storedNickname = useAppStore((s) => s.nickname);
  const setNickname = useAppStore((s) => s.setNickname);

  const [created, setCreated] = useState<Challenge | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [activityId, setActivityId] = useState('pushups');
  const [customUnit, setCustomUnit] = useState('');
  const [target, setTarget] = useState('100');
  const [nickname, setLocalNick] = useState(storedNickname);
  const [visibility, setVisibility] = useState<Visibility>('private');
  const [timezone, setTimezone] = useState(
    TIMEZONES.includes(DEVICE_TIMEZONE) ? DEVICE_TIMEZONE : 'Africa/Lagos',
  );

  const today = todayInZone(timezone);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(addDays(today, 29));

  const activity = getActivity(activityId);
  const unit = activityId === 'custom' ? customUnit.trim() || 'count' : activity.unit;

  const problems = useMemo(() => {
    const list: string[] = [];
    if (name.trim().length < 3) list.push('Give the challenge a name (3+ characters).');
    if (nickname.trim().length < 1) list.push('Enter the name others will see.');
    const t = Number(target);
    if (!Number.isFinite(t) || t < 1) list.push('Daily target must be at least 1.');
    if (t > activity.maxDaily) list.push(`Daily target looks too high for ${activity.label}.`);
    if (end < start) list.push('End date must be on or after the start date.');
    return list;
  }, [name, nickname, target, activity, start, end]);

  const submit = async () => {
    if (problems.length) return;
    setSaving(true);
    setError(null);
    try {
      await setNickname(nickname);
      const challenge = await createChallenge({
        name: name.trim(),
        activity_type: activityId,
        tracking_mode: activity.tracking,
        unit,
        daily_target: Math.round(Number(target)),
        start_date: start,
        end_date: end,
        visibility,
        timezone,
        nickname: nickname.trim(),
      });
      setCreated(challenge);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the challenge.');
    } finally {
      setSaving(false);
    }
  };

  if (created) {
    return (
      <AppShell title="Challenge created" back="/">
        <div className="space-y-5 pt-2">
          <div className="text-center">
            <p className="text-4xl" aria-hidden>
              🎉
            </p>
            <h2 className="mt-2 text-2xl font-bold">{created.name}</h2>
            <p className="text-muted">
              {created.daily_target.toLocaleString()} {created.unit} every day
            </p>
          </div>

          <ShareChallenge
            name={created.name}
            code={created.code}
            dailyTarget={created.daily_target}
            unit={created.unit}
          />

          <Button full variant="secondary" onClick={() => navigate(`/challenge/${created.id}`)}>
            Go to the challenge
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="New challenge" back="/">
      <div className="space-y-5">
        <div>
          <label className="label" htmlFor="c-name">
            Challenge name
          </label>
          <input
            id="c-name"
            className="input"
            value={name}
            maxLength={60}
            placeholder="September 100"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <span className="label">Activity</span>
          <div className="grid grid-cols-2 gap-2">
            {ACTIVITIES.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  setActivityId(a.id);
                  setTarget(String(a.defaultTarget));
                }}
                aria-pressed={activityId === a.id}
                className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm transition ${
                  activityId === a.id
                    ? 'border-flame bg-flame/10'
                    : 'border-line bg-surface2 hover:border-muted/40'
                }`}
              >
                <span aria-hidden>{a.emoji}</span>
                <span className="min-w-0 flex-1 truncate">{a.label}</span>
                {a.tracking === 'cv' && (
                  <span className="rounded bg-lime/20 px-1.5 py-0.5 text-[10px] font-semibold text-lime">
                    AUTO
                  </span>
                )}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            {activity.tracking === 'cv'
              ? 'Counted automatically by your camera — and you can always log it by hand.'
              : 'Participants log this one themselves.'}
          </p>
        </div>

        {activityId === 'custom' && (
          <div>
            <label className="label" htmlFor="c-unit">
              What are you counting?
            </label>
            <input
              id="c-unit"
              className="input"
              value={customUnit}
              maxLength={16}
              placeholder="glasses of water"
              onChange={(e) => setCustomUnit(e.target.value)}
            />
          </div>
        )}

        <div>
          <label className="label" htmlFor="c-target">
            Daily target ({unit})
          </label>
          <input
            id="c-target"
            className="input tabular"
            type="number"
            inputMode="numeric"
            min={1}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="c-start">
              Starts
            </label>
            <input
              id="c-start"
              className="input"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="c-end">
              Ends
            </label>
            <input
              id="c-end"
              className="input"
              type="date"
              value={end}
              min={start}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="c-tz">
            Day resets in
          </label>
          <select
            id="c-tz"
            className="input"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace('_', ' ')}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-muted">
            Streaks and "today" follow this timezone for everyone in the challenge.
          </p>
        </div>

        <div>
          <span className="label">Who can join?</span>
          <div className="grid grid-cols-2 gap-2">
            {(['private', 'public'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setVisibility(v)}
                aria-pressed={visibility === v}
                className={`rounded-xl border px-3 py-3 text-sm transition ${
                  visibility === v
                    ? 'border-flame bg-flame/10'
                    : 'border-line bg-surface2 hover:border-muted/40'
                }`}
              >
                <span className="block font-medium">{v === 'private' ? 'Private' : 'Public'}</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {v === 'private' ? 'Code or link only' : 'Listed in Explore'}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="c-nick">
            Your name on the leaderboard
          </label>
          <input
            id="c-nick"
            className="input"
            value={nickname}
            maxLength={24}
            placeholder="Ovie"
            onChange={(e) => setLocalNick(e.target.value)}
          />
        </div>

        {problems.length > 0 && name.length > 0 && (
          <ul className="space-y-1 text-sm text-muted">
            {problems.map((p) => (
              <li key={p}>• {p}</li>
            ))}
          </ul>
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}

        <Button full onClick={submit} loading={saving} disabled={problems.length > 0}>
          Create challenge
        </Button>
      </div>
    </AppShell>
  );
}
