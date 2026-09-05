import { useState } from 'react';
import { Button } from './Button';
import type { RecordedClip } from '@/features/workout/recording/useRecorder';

function filenameFor(clip: RecordedClip, challengeName: string, reps: number): string {
  const safe = challengeName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  return `showup-${safe || 'workout'}-${reps}-${date}.${clip.extension}`;
}

/**
 * The clip lives in memory only — never uploaded, never written to a database.
 * That means it is also gone when this session ends, so the save and share
 * options are put in front of the participant immediately rather than filed
 * away somewhere they would have to go looking.
 */
export function VideoResult({
  clip,
  challengeName,
  reps,
  onDiscard,
}: {
  clip: RecordedClip;
  challengeName: string;
  reps: number;
  onDiscard?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const filename = filenameFor(clip, challengeName, reps);
  const file = new File([clip.blob], filename, { type: clip.mimeType });
  const canShareFile =
    typeof navigator !== 'undefined' &&
    !!navigator.canShare &&
    navigator.canShare({ files: [file] });

  const share = async () => {
    setBusy(true);
    setNote(null);
    try {
      await navigator.share({
        files: [file],
        title: challengeName,
        text: `${reps} today. ${challengeName} 💪`,
      });
      setSaved(true);
    } catch (err) {
      const e = err as DOMException;
      if (e?.name !== 'AbortError') {
        setNote('Sharing was blocked — use Save to phone instead.');
      }
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    const a = document.createElement('a');
    a.href = clip.url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setSaved(true);
    setNote('Saved to your phone — look in Downloads (or Files on iPhone).');
  };

  const seconds = Math.round(clip.durationMs / 1000);
  const mb = (clip.bytes / 1e6).toFixed(1);

  return (
    <div className="card text-left">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-semibold">Your clip</h3>
        <span className="text-xs text-muted tabular">
          {seconds}s · {mb} MB
        </span>
      </div>

      <video
        src={clip.url}
        controls
        playsInline
        className="w-full rounded-xl bg-black"
        preload="metadata"
      />

      <div className="mt-3 space-y-2">
        {canShareFile && (
          <Button full onClick={share} loading={busy}>
            Share to WhatsApp
          </Button>
        )}
        <Button full variant={canShareFile ? 'secondary' : 'primary'} onClick={download}>
          Save to phone
        </Button>
      </div>

      {note && <p className="mt-2 text-sm text-muted">{note}</p>}

      <p className="mt-3 text-xs text-muted">
        {saved
          ? 'This clip stays on your phone. Showup never uploaded it.'
          : 'Save or share it now — the video is only held in memory and is not stored anywhere.'}
      </p>

      {onDiscard && (
        <button
          onClick={onDiscard}
          className="mt-2 w-full py-1 text-center text-sm text-muted underline underline-offset-4"
        >
          Discard clip
        </button>
      )}
    </div>
  );
}
