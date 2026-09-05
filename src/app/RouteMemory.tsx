import { useEffect, useRef } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { rememberRoute, routeToRestore } from '@/lib/appMemory';

/**
 * Remembers where you were, and puts you back there on a cold launch.
 *
 * An installed PWA always relaunches at the manifest's start_url ("/"), so
 * without this, iOS dropping the app from memory sends the participant back to
 * the landing page every single time — which reads as "the app keeps
 * refreshing and losing my place".
 *
 * Restore happens only when the launch actually landed on "/". A shared
 * /join/CODE link, a back-navigation, or any real destination is left alone.
 */
export function RouteMemory() {
  const location = useLocation();
  const navigate = useNavigate();
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    if (location.pathname !== '/') return;

    let cancelled = false;
    void (async () => {
      const target = await routeToRestore();
      if (!cancelled && target && target !== location.pathname) {
        navigate(target, { replace: true });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.pathname, navigate]);

  useEffect(() => {
    void rememberRoute(location.pathname);
  }, [location.pathname]);

  // iOS can kill a backgrounded app without another event, so the current
  // route is flushed the moment the app is hidden as well.
  useEffect(() => {
    const flush = () => void rememberRoute(window.location.pathname);
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, []);

  return <Outlet />;
}
