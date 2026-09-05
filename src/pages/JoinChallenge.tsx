import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/Button';
import { getChallengeByCode, joinChallenge } from '@/features/challenges/api';
import { getActivity } from '@/lib/activities';
import { formatRange } from '@/lib/dates';
import { useAppStore } from '@/store/appStore';
import type { ChallengePreview } from '@/lib/types';

export function JoinChallenge() {
  const { code: codeParam } = useParams();
  const navigate = useNavigate();
  const storedNickname = useAppStore((s) => s.nickname);
  const setNickname = useAppStore((s) => s.setNickname);

  const [code, setCode] = useState((codeParam ?? '').toUpperCase());
  const [preview, setPreview] = useState<ChallengePreview | null>(null);
  const [nickname, setLocalNick] = useState(storedNickname);
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setLocalNick(storedNickname), [storedNickname]);

  const lookup = async (value: string) => {
    setLoading(true);
    setError(null);
    try {
      const found = await getChallengeByCode(value);
      if (!found) {
        setError("That code doesn't match any challenge.");
        setPreview(null);
        return;
      }
      if (found.already_joined) {
        navigate(`/challenge/${found.id}`, { replace: true });
        return;
      }
      setPreview(found);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not look that up.');
    } finally {
      setLoading(false);
    }
  };

  // Arriving from a shared link: resolve the code immediately.
  useEffect(() => {
    if (codeParam) void lookup(codeParam.toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeParam]);

  const join = async () => {
    if (!preview || nickname.trim().length < 1) return;
    setJoining(true);
    setError(null);
    try {
      await setNickname(nickname);
      const id = await joinChallenge(preview.code, nickname);
      navigate(`/challenge/${id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join.');
    } finally {
      setJoining(false);
    }
  };

  if (preview) {
    const activity = getActivity(preview.activity_type);
    return (
      <AppShell title="Join challenge" back={() => setPreview(null)}>
        <div className="space-y-5">
          <div className="card text-center">
            <span className="text-3xl" aria-hidden>
              {activity.emoji}
            </span>
            <h2 className="mt-2 text-2xl font-bold">{preview.name}</h2>
            <p className="mt-1 text-muted">
              {preview.daily_target.toLocaleString()} {preview.unit} every day
            </p>
            <p className="text-sm text-muted">
              {formatRange(preview.start_date, preview.end_date)}
            </p>
            <p className="mt-3 text-sm text-muted">
              {preview.participant_count}{' '}
              {preview.participant_count === 1 ? 'participant' : 'participants'}
              {preview.creator_nickname && <> · started by {preview.creator_nickname}</>}
            </p>
          </div>

          <div>
            <label className="label" htmlFor="j-nick">
              What should we call you?
            </label>
            <input
              id="j-nick"
              className="input"
              value={nickname}
              maxLength={24}
              autoFocus
              placeholder="Ovie"
              onChange={(e) => setLocalNick(e.target.value)}
            />
            <p className="mt-1.5 text-xs text-muted">
              No account, no password — just the name others will see.
            </p>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <Button full onClick={join} loading={joining} disabled={nickname.trim().length < 1}>
            Join challenge
          </Button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Join a challenge" back="/">
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.length >= 6) void lookup(code);
        }}
      >
        <div>
          <label className="label" htmlFor="j-code">
            Enter challenge code
          </label>
          <input
            id="j-code"
            className="input text-center font-mono text-2xl uppercase tracking-[0.3em]"
            value={code}
            maxLength={8}
            autoFocus
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="X7K9P2"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <Button full type="submit" loading={loading} disabled={code.length < 6}>
          Continue
        </Button>

        <p className="text-center text-sm text-muted">
          Got a link instead? Tap it and this step is skipped.
        </p>
      </form>
    </AppShell>
  );
}
