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

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
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
      stop();

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
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.setAttribute('playsinline', 'true');
          video.muted = true;
          await video.play().catch(() => undefined);
        }

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
    [stop, videoRef],
  );

  useEffect(() => stop, [stop]);

  return { ...state, start, stop };
}
