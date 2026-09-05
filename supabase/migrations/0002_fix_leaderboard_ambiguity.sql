-- ============================================================================
-- Showup — 0002: fix "column reference is ambiguous" in the leaderboard
--
-- A RETURNS TABLE column name is also an in-scope variable inside the function
-- body, so `user_id`, `nickname`, `today_count` etc. collided with the columns
-- of the same name in the query. get_leaderboard raised the error at runtime;
-- get_public_challenges had the same latent problem in its ORDER BY.
--
-- Fix: qualify every reference, name internal aliases so they cannot collide
-- with the output columns, and tell PL/pgSQL that columns win a tie.
--
-- Safe to run on an existing database: it only replaces two functions. No
-- schema, policy or data changes. Re-running it is harmless.
-- ============================================================================

create or replace function public.get_public_challenges(
  p_filter text default 'trending',
  p_limit integer default 30,
  p_offset integer default 0
)
returns table (
  id uuid,
  name text,
  code text,
  activity_type text,
  tracking_mode text,
  unit text,
  daily_target integer,
  start_date date,
  end_date date,
  description text,
  participant_count bigint,
  active_today bigint,
  creator_nickname text
)
language sql
stable
security definer
set search_path = public
as $$
  -- Internal aliases are deliberately NOT the same as this function's output
  -- column names: a RETURNS TABLE column name is in scope inside the body, so
  -- an unqualified `participant_count` would be ambiguous against the CTE's.
  with base as (
    select
      c.id            as b_id,
      c.name          as b_name,
      c.code          as b_code,
      c.activity_type as b_activity,
      c.tracking_mode as b_tracking,
      c.unit          as b_unit,
      c.daily_target  as b_target,
      c.start_date    as b_start,
      c.end_date      as b_end,
      c.description   as b_description,
      c.created_at    as b_created,
      (select count(*) from public.participants p where p.challenge_id = c.id) as b_participants,
      (select count(*) from public.workouts w
        where w.challenge_id = c.id
          and w.workout_date = (now() at time zone c.timezone)::date) as b_active_today,
      (select u.nickname from public.users u where u.id = c.creator_id) as b_creator
    from public.challenges c
    where c.visibility = 'public'
  )
  select
    b.b_id, b.b_name, b.b_code, b.b_activity, b.b_tracking, b.b_unit, b.b_target,
    b.b_start, b.b_end, b.b_description, b.b_participants, b.b_active_today, b.b_creator
  from base b
  where case
    when p_filter = 'ending_soon' then b.b_end >= current_date
    else true
  end
  order by
    case when p_filter = 'new'         then extract(epoch from b.b_created) end desc nulls last,
    case when p_filter = 'ending_soon' then -extract(epoch from b.b_end::timestamptz) end desc nulls last,
    case when p_filter = 'most_active' then b.b_active_today end desc nulls last,
    -- 'trending' default: participation weighted towards people active today
    (b.b_participants + b.b_active_today * 3) desc,
    b.b_created desc
  limit least(coalesce(p_limit, 30), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.get_leaderboard(p_challenge_id uuid)
returns table (
  user_id uuid,
  nickname text,
  today_count integer,
  total_count bigint,
  completed_days bigint,
  current_streak integer,
  longest_streak integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
-- Every RETURNS TABLE column above (user_id, nickname, today_count, …) is also
-- a variable inside this body. Any unqualified reference to a column of the
-- same name would raise "column reference is ambiguous", so: this directive
-- makes columns win, AND every internal alias below is named so it cannot
-- collide in the first place.
#variable_conflict use_column
declare
  v_challenge public.challenges;
  v_today date;
begin
  select * into v_challenge from public.challenges where id = p_challenge_id;
  if v_challenge is null then
    raise exception 'challenge not found' using errcode = 'P0002';
  end if;

  -- Only members (or the organizer) may read a leaderboard, and a public
  -- challenge's board is readable by anyone signed in.
  if v_challenge.visibility <> 'public'
     and not public.is_participant(p_challenge_id)
     and v_challenge.creator_id <> auth.uid() then
    raise exception 'not authorized to view this leaderboard';
  end if;

  v_today := (now() at time zone v_challenge.timezone)::date;

  return query
  with completed as (
    -- Days where the participant met the target. Streaks are built from these.
    select w.user_id as c_uid, w.workout_date as c_date
    from public.workouts w
    where w.challenge_id = p_challenge_id
      and w.count >= v_challenge.daily_target
  ),
  grouped as (
    -- Classic gaps-and-islands: consecutive dates share (date - row_number).
    select
      c.c_uid  as g_uid,
      c.c_date as g_date,
      c.c_date - (row_number() over (partition by c.c_uid order by c.c_date))::int as g_grp
    from completed c
  ),
  runs as (
    select
      g.g_uid as r_uid,
      g.g_grp as r_grp,
      count(*)::int as r_len,
      max(g.g_date) as r_end
    from grouped g
    group by g.g_uid, g.g_grp
  ),
  streaks as (
    select
      r.r_uid as s_uid,
      coalesce(max(r.r_len), 0) as s_longest,
      -- A streak is still "current" if its last completed day is today or
      -- yesterday; yesterday keeps the streak alive until the day is over.
      coalesce(max(r.r_len) filter (where r.r_end >= v_today - 1), 0) as s_current
    from runs r
    group by r.r_uid
  ),
  totals as (
    select
      w.user_id as t_uid,
      coalesce(sum(w.count), 0)::bigint as t_total,
      coalesce(sum(w.count) filter (where w.workout_date = v_today), 0)::int as t_today,
      count(*) filter (where w.count >= v_challenge.daily_target)::bigint as t_days
    from public.workouts w
    where w.challenge_id = p_challenge_id
    group by w.user_id
  )
  select
    p.user_id,
    p.nickname,
    coalesce(t.t_today, 0),
    coalesce(t.t_total, 0)::bigint,
    coalesce(t.t_days, 0)::bigint,
    coalesce(s.s_current, 0),
    coalesce(s.s_longest, 0)
  from public.participants p
  left join totals t on t.t_uid = p.user_id
  left join streaks s on s.s_uid = p.user_id
  where p.challenge_id = p_challenge_id
  order by coalesce(t.t_total, 0) desc, coalesce(s.s_longest, 0) desc, p.joined_at asc;
end;
$$;

grant execute on function
  public.get_public_challenges(text,integer,integer),
  public.get_leaderboard(uuid)
to authenticated;
