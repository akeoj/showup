# Showup

Create a challenge. Invite your people. Show up every day.

An offline-first PWA for running measurable daily challenges. Push-ups are counted
on-device by the camera; everything else is self-reported. Built to the
Challenge Platform PRD/TRD — React + TypeScript + Vite + Tailwind, Supabase for
persistence, MediaPipe Pose for counting, IndexedDB for offline.

---

## Getting it running

### 1. Supabase

1. Create a project at supabase.com.
2. **SQL Editor → New query** → paste all of `supabase/migrations/0001_init.sql` → Run.
3. **Authentication → Providers → Anonymous sign-ins → enable.**
   Without this nobody can join: every participant is an anonymous auth user.
4. **Project Settings → API** → copy the Project URL and the `anon` key.

The anon key is meant to be public — every table is behind RLS, and the
sensitive paths (joining a private challenge, saving a workout, reading a
leaderboard) go through `SECURITY DEFINER` functions that re-check membership.

### 2. The app

```bash
cp .env.example .env.local     # paste your URL + anon key
npm install
npm run dev
```

### 3. Testing on a real phone

The camera needs a **secure context**. `http://192.168.x.x:5173` will not get
camera access — `getUserMedia` is simply absent, and the app will say so. Use a
tunnel:

```bash
npx localtunnel --port 5173      # or: cloudflared tunnel --url http://localhost:5173
```

Deploy to Vercel (`vercel deploy`) and you get HTTPS for free. Set the same two
env vars in the Vercel project, plus `VITE_PUBLIC_URL=https://your-domain` so
share links point at the right host.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Typecheck + production build |
| `npm run preview` | Serve the built app |
| `npm test` | Unit tests for the rep counter |

---

## How it's put together

```
src/
├── lib/            supabase client, Dexie store, sync manager, dates, activities
├── features/
│   ├── challenges/ API (RPC calls) + hooks, including the realtime leaderboard
│   └── workout/    camera, pose engine, push-up state machine
├── components/     Button, Leaderboard, ShareChallenge, ManualEntry, DayCalendar…
├── pages/          one file per route
└── store/          nickname + user id + last workout result
```

### The write path

There is exactly one: `recordWorkout()`.

```
finish workout → IndexedDB (final daily total) → queue → save_workout RPC
```

The client always sends the **final total for the day**, never a delta, and
`save_workout` upserts on `(challenge_id, user_id, workout_date)` keeping the
larger value. A queue item replayed twice is therefore harmless, and two devices
disagreeing never silently erases reps.

The sync queue collapses per challenge-day, backs off exponentially
(2s → 30m), and drops items the server will never accept (date outside the
window, count over the cap) rather than letting a poison item block the queue.
Retries fire on: online event, app start, foreground, `pageshow`, and a 60s
timer — Background Sync is deliberately not depended on.

### The counter

`src/features/workout/pushup/` is pure and framework-free, which is what makes
it testable:

- `config.ts` — every threshold in one place. Nothing else hard-codes a number.
- `geometry.ts` — elbow angle, body straightness, torso tilt, median+EMA smoothing.
- `stateMachine.ts` — `idle → calibrating → up → down → up = 1 rep`.

A rep counts only if: it reached depth, travelled far enough (range of motion),
took longer than `minRepDurationMs`, finished within `maxRepDurationMs`, cleared
the cooldown, and the pose stayed visible the whole way. Body position is checked
before any of that — bending your arms while standing counts nothing.

`npm test` runs 12 cases against synthetic landmark sequences (clean reps,
shallow reps, shaken phone, pose lost mid-rep, stalling at the bottom).

Frames are processed at camera rate but React only hears about *events* — a
counted rep, a state change, a coaching line. The skeleton draws to a canvas and
angles live in refs, so a 30fps pipeline is not 30 renders (or 30 DB writes) a
second.

### Timezones and streaks

Every date is a *challenge-local* calendar date, derived from the challenge's
timezone (`Africa/Lagos` default) in both the client (`todayInZone`) and Postgres
(`now() at time zone c.timezone`). A day counts when the total meets or exceeds
the target; streaks are computed server-side with gaps-and-islands over completed
days, and a streak stays "current" while its last completed day is today or
yesterday.

---

## Decisions worth knowing about

**Manual entry exists everywhere.** On a low-end Android the pose model may be
unusable, and a challenge nobody can log into is worse than one logged on trust —
the spreadsheet this replaces was 100% self-reported. There's a "log it myself"
button on the dashboard, on the workout intro screen, and ± buttons on the live
counter for when it miscounts.

**Non-CV activities ship on day one.** Reading, prayer, steps, study, running,
custom. Same challenge machinery, no camera. It makes this a challenge platform
rather than a push-up app, and it's the difference between a church group and a
gym both being able to use it.

**Private challenges are not enumerable.** RLS only exposes a challenge to its
creator, its participants, or anyone if it's public. Joining by code goes through
a `SECURITY DEFINER` function, so a private challenge is joinable by someone
holding the code without ever being readable to them beforehand.

**The lite pose model by default.** The full model drops to single-digit FPS on
cheap Androids; a counter that misses reps is worse than a slightly noisier one
that keeps up. Override with `VITE_POSE_MODEL_URL`. The wasm and `.task` file are
cached CacheFirst by the service worker, so the second workout starts instantly
and works with no connection.

---

## What is not built yet

Honest list, so you don't discover these in front of users:

- **CV accuracy is untuned against real footage.** The thresholds in `config.ts`
  are reasoned, not measured. Record 5–10 videos across body types, camera
  distances and lighting, count by hand, and tune. That is the actual day-6 work,
  and it is the risk in this whole product.
- **No rate limiting.** Anonymous auth means challenge creation is free to spam.
  Fine at 15 users; add a Supabase Edge Function or a per-user creation cap before
  Explore is public.
- **Organizer tools are read-only.** `/manage` shows participants and stats; it
  can't remove someone or edit a challenge after creation. Both are small RLS-safe
  additions when you need them.
- **No analytics.** The events worth measuring are listed in the PRD §42; wire a
  privacy-friendly collector (Plausible, Umami) when there's traffic worth reading.
- **Identity is device-bound.** An anonymous session lives in that browser's
  localStorage. Clearing site data or switching phones loses the identity — the
  upgrade path is Supabase's `linkIdentity` to attach email/Google later, which
  the schema already accommodates since `users.id` is the auth user.
- **No push notifications.** The single biggest lever on daily completion rate,
  and the obvious next build.
