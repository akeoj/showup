import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Home } from '@/pages/Home';
import { CreateChallenge } from '@/pages/CreateChallenge';
import { JoinChallenge } from '@/pages/JoinChallenge';
import { Explore } from '@/pages/Explore';
import { ChallengePage } from '@/pages/Challenge';
import { Results } from '@/pages/Results';
import { LeaderboardPage } from '@/pages/LeaderboardPage';
import { Manage } from '@/pages/Manage';

// The workout screen pulls in the MediaPipe runtime; keeping it lazy means the
// landing page stays small on a slow connection.
const Workout = lazy(() => import('@/pages/Workout').then((m) => ({ default: m.Workout })));

const Loading = () => <p className="p-10 text-center text-muted">Loading…</p>;

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/create', element: <CreateChallenge /> },
  { path: '/join', element: <JoinChallenge /> },
  { path: '/join/:code', element: <JoinChallenge /> },
  { path: '/explore', element: <Explore /> },
  { path: '/challenge/:id', element: <ChallengePage /> },
  {
    path: '/challenge/:id/workout',
    element: (
      <Suspense fallback={<Loading />}>
        <Workout />
      </Suspense>
    ),
  },
  { path: '/challenge/:id/results', element: <Results /> },
  { path: '/challenge/:id/leaderboard', element: <LeaderboardPage /> },
  { path: '/challenge/:id/manage', element: <Manage /> },
  { path: '*', element: <Home /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
