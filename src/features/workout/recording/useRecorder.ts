import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderStatus = 'idle' | 'unsupported' | 'recording' | 'stopping' | 'done' | 'error';

export interface RecordedClip {
  blob: Blob;
  url: string;
  mimeType: string;
  extension: string;
  durationMs: number;
  bytes: number;
}

/** What gets burned into the frame, supplied fresh on every composite. */
export interface OverlayState {
  reps: number;
  unit: string;
  challengeName: string;
  targetLine?: string;
}

/**
 * Prefer MP4.
 *
 * WebM is Chrome-only: iOS cannot play it back and WhatsApp handles it badly,
 * so a WebM "flex video" would fail at exactly the moment it matters. Chrome
 * on Android has supported MP4 recording since 111; anything older falls back.
 */
const CANDIDATES: { mime: string; ext: string }[] = [
  { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4' },
  { mime: 'video/mp4', ext: 'mp4' },
  { mime: 'video/webm;codecs=vp9', ext: 'webm' },
  { mime: 'video/webm;codecs=vp8', ext: 'webm' },
  { mime: 'video/webm', ext: 'webm' },
];

function pickMimeType(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const c of CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(c.mime)) return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

export function recordingSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    pickMimeType() !== null
  );
}

/** Hard ceiling so a forgotten recording cannot exhaust a cheap phone's RAM. */
const MAX_DURATION_MS = 5 * 60 * 1000;
const MAX_BYTES = 120 * 1024 * 1024;

/**
 * Records the workout with the live rep count burned into the picture.
 *
 * Everything stays on the device: the frames are composited locally, the blob
 * lives in memory, and it is handed to the OS share sheet or a download. It is
 * never uploaded, and deliberately never written to IndexedDB either — the
 * video is the one piece of this product that is nobody's business but the
 * participant's.
 *
 * The composite only runs while recording, so the CV pipeline pays nothing for
 * this feature unless it is switched on.
 */
export function useRecorder(videoRef: React.RefObject<HTMLVideoElement>) {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const startedAtRef = useRef(0);
  const overlayRef = useRef<OverlayState>({ reps: 0, unit: 'reps', challengeName: '' });
  const bytesRef = useRef(0);
  const stopResolveRef = useRef<((clip: RecordedClip | null) => void) | null>(null);
  const chosenRef = useRef<{ mime: string; ext: string } | null>(null);

  useEffect(() => {
    if (!recordingSupported()) setStatus('unsupported');
  }, []);

  /** Called every frame while recording; cheap to update, no re-render. */
  const setOverlay = useCallback((o: OverlayState) => {
    overlayRef.current = o;
  }, []);

  const composite = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Drawn unmirrored on purpose. The preview is mirrored so movement feels
    // natural, but a mirrored recording would render the burned-in numbers
    // backwards the moment it is shared.
    ctx.drawImage(video, 0, 0, w, h);

    const o = overlayRef.current;
    const pad = Math.round(w * 0.04);
    const big = Math.round(h * 0.16);
    const small = Math.round(h * 0.045);

    // Legibility over whatever is behind it.
    const grad = ctx.createLinearGradient(0, h * 0.55, 0, h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, h * 0.55, w, h * 0.45);

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 ${big}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(String(o.reps), pad, h - pad - small * 1.6);

    const repsWidth = ctx.measureText(String(o.reps)).width;
    ctx.font = `500 ${small}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(o.unit.toUpperCase(), pad + repsWidth + pad * 0.4, h - pad - small * 1.6);

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `600 ${small}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
    ctx.fillText(o.challengeName, pad, h - pad - small * 0.35);

    if (o.targetLine) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.font = `400 ${Math.round(small * 0.8)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(o.targetLine, w - pad, h - pad - small * 0.35);
    }

    // Small wordmark: every shared clip is an advert for the challenge.
    ctx.textAlign = 'right';
    ctx.fillStyle = '#FF6B35';
    ctx.font = `700 ${Math.round(small * 0.85)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillText('SHOWUP', w - pad, pad + small * 0.85);
  }, [videoRef]);

  const tick = useCallback(() => {
    if (!recorderRef.current || recorderRef.current.state !== 'recording') return;
    composite();
    setElapsedMs(Date.now() - startedAtRef.current);
    if (Date.now() - startedAtRef.current > MAX_DURATION_MS) {
      recorderRef.current.stop();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [composite]);

  const start = useCallback(
    (initial: OverlayState): boolean => {
      const video = videoRef.current;
      if (!video || !recordingSupported()) {
        setStatus('unsupported');
        return false;
      }

      const chosen = pickMimeType();
      if (!chosen) {
        setStatus('unsupported');
        return false;
      }
      chosenRef.current = chosen;
      overlayRef.current = initial;

      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        canvasRef.current = canvas;

        const stream = canvas.captureStream(30);
        const recorder = new MediaRecorder(stream, {
          mimeType: chosen.mime,
          videoBitsPerSecond: 2_500_000,
        });

        chunksRef.current = [];
        bytesRef.current = 0;

        recorder.ondataavailable = (e) => {
          if (!e.data || e.data.size === 0) return;
          bytesRef.current += e.data.size;
          if (bytesRef.current > MAX_BYTES) {
            if (recorder.state === 'recording') recorder.stop();
            return;
          }
          chunksRef.current.push(e.data);
        };

        recorder.onstop = () => {
          if (rafRef.current) cancelAnimationFrame(rafRef.current);
          const blob = new Blob(chunksRef.current, { type: chosen.mime });
          chunksRef.current = [];
          stream.getTracks().forEach((t) => t.stop());

          const clip: RecordedClip | null =
            blob.size > 0
              ? {
                  blob,
                  url: URL.createObjectURL(blob),
                  mimeType: chosen.mime,
                  extension: chosen.ext,
                  durationMs: Date.now() - startedAtRef.current,
                  bytes: blob.size,
                }
              : null;

          setStatus(clip ? 'done' : 'error');
          if (!clip) setError('The recording came out empty.');
          stopResolveRef.current?.(clip);
          stopResolveRef.current = null;
          recorderRef.current = null;
        };

        recorder.onerror = () => {
          setStatus('error');
          setError('Recording stopped unexpectedly.');
        };

        recorderRef.current = recorder;
        startedAtRef.current = Date.now();
        setElapsedMs(0);
        setError(null);
        setStatus('recording');
        // Timeslice so data arrives progressively; a crash then costs seconds,
        // not the whole clip.
        recorder.start(1000);
        rafRef.current = requestAnimationFrame(tick);
        return true;
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Could not start recording.');
        return false;
      }
    },
    [tick, videoRef],
  );

  const stop = useCallback((): Promise<RecordedClip | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return Promise.resolve(null);
    setStatus('stopping');
    return new Promise((resolve) => {
      stopResolveRef.current = resolve;
      recorder.stop();
    });
  }, []);

  const cancel = useCallback(() => {
    const recorder = recorderRef.current;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    chunksRef.current = [];
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    recorderRef.current = null;
    setStatus('idle');
  }, []);

  useEffect(() => cancel, [cancel]);

  return { status, elapsedMs, error, start, stop, cancel, setOverlay };
}
