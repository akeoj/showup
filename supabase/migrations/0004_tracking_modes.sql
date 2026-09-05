-- ============================================================================
-- Showup — 0004: timer and check-in tracking
--
-- Until now every non-push-up activity was "type a number", which verifies
-- nothing and is exactly what the spreadsheet already did. Two more modes:
--
--   timer   — the app runs a stopwatch and logs real elapsed time. For prayer,
--             study, meditation, planks. Roughly the same strength of evidence
--             as the rep counter, for a fraction of the complexity.
--   checkin — one button, done or not done. For habits where a count is
--             meaningless: forcing "did you pray today" into a number is why
--             habit trackers feel wrong.
--
-- No new columns: a timer logs its unit (minutes or seconds) into `count`, and
-- a check-in logs 1 against a daily_target of 1. Streaks, leaderboards and the
-- sync queue all keep working untouched.
--
-- Safe to run on an existing database.
-- ============================================================================

-- Drop whatever check currently constrains these columns, whatever it is
-- called, rather than assuming Postgres' default naming held.
do $$
declare r record;
begin
  for r in
    select conname, conrelid::regclass as tbl
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.challenges'::regclass, 'public.workouts'::regclass)
      and (pg_get_constraintdef(oid) ilike '%tracking_mode%'
           or pg_get_constraintdef(oid) ilike '%source%')
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.challenges
  add constraint challenges_tracking_mode_check
  check (tracking_mode in ('cv', 'manual', 'timer', 'checkin'));

alter table public.workouts
  add constraint workouts_source_check
  check (source in ('cv', 'manual', 'timer', 'checkin'));

-- create_challenge validates nothing about the mode itself; the constraint
-- above is the authority, so an old client sending 'manual' still works.
