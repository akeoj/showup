import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'unavailable' | 'error';

export interface CameraState {
  status: CameraStatus;
  error: string | null;
  facing: 'user' | 'environment';
}

/**
 * getUserMedia only exists in a secure context, so over plain http on a LAN IP
 * the API is missing entirely rather than merely denied — worth telling the
 * user apart from a permission refusal, because the fix is completely different.
 */
export function useCamera(videoRef: React.RefObject<HTMLVideoElement>) {
  const [state, setState] = useState<CameraState>({ status: 'idle', error: null, facing: 'user' });
  const streamRef = useRef<MediaStream | null>(null);

  /**
   * Bind the live stream to the <video> element.
   *
   * Kept separate from start() and safe to call repeatedly, because the two
   * can happen in either order: the element may mount after the stream is
   * acquired, or a re-render may hand us a different element. Attaching only
   * inside start() is how you end up with the camera light on and a black
   * screen — the stream exists, but nothing is showing it.
   */
  const attach = useCallback((): boolean => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return false;

    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    video.setAttribute('playsinline', 'true');
    video.muted = true;
    void video.play().catch(() => undefined);
    return true;
  }, [videoRef]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState((s) => ({ ...s, status: 'idle' }));
  }, [videoRef]);

  const start = useCallback(
    async (facing: 'user' | 'environment' = 'user') => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setState({
          status: 'unavailable',
          facing,
          error: window.isSecureContext
            ? 'This browser does not expose a camera to web apps.'
            : 'The camera needs a secure connection (https). Open the app over https and try again.',
        });
        return false;
      }

      setState((s) => ({ ...s, status: 'requesting', error: null, facing }));

      // Release any previous stream before asking for another, or some phones
      // hand back a dead track.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            // 640×480 is plenty for pose landmarks and keeps mid-range phones
            // from spending their frame budget scaling pixels we throw away.
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        });

        streamRef.current = stream;
        attach();
        setState({ status: 'ready', error: null, facing });
        return true;
      } catch (err) {
        const e = err as DOMException;
        const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError';
        setState({
          status: denied ? 'denied' : 'error',
          facing,
          error: denied
            ? 'Camera permission was blocked. Allow it in your browser settings, then reload.'
            : e?.name === 'NotFoundError'
              ? 'No camera found on this device.'
              : (e?.message ?? 'Could not start the camera.'),
        });
        return false;
      }
    },
    [attach],
  );

  const flip = useCallback(async () => {
    return start(state.facing === 'user' ? 'environment' : 'user');
  }, [start, state.facing]);

  // Re-attach whenever the element or the stream changes hands. Cheap, and it
  // covers every ordering the React tree can produce.
  useEffect(() => {
    attach();
  });

  // Coming back from the background can leave the element paused on iOS.
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === 'visible') attach();
    };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, [attach]);

  useEffect(() => stop, [stop]);

  return { ...state, start, stop, attach, flip, stream: streamRef };
}
