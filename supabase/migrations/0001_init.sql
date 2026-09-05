-- ============================================================================
-- Showup — initial schema, RLS and leaderboard functions
-- Run this in the Supabase SQL editor (or `supabase db push`).
--
-- Design notes that matter:
--  * Every participant is an ANONYMOUS auth user. auth.uid() is the identity.
--  * Private challenges must be joinable by code but NOT enumerable. That is
--    why joining and code lookup go through SECURITY DEFINER functions rather
--    than a permissive SELECT policy on `challenges`.
--  * Membership checks live in SECURITY DEFINER helpers so RLS policies on
--    `participants` do not recurse into themselves.
--  * The client never writes a leaderboard. It reads aggregates computed here.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  nickname    text not null check (char_length(btrim(nickname)) between 1 and 24),
  created_at  timestamptz not null default now()
);

create table if not exists public.challenges (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(btrim(name)) between 3 and 60),
  code            text not null unique check (code ~ '^[A-Z0-9]{6,8}$'),
  creator_id      uuid not null references auth.users(id) on delete cascade,
  activity_type   text not null,
  -- 'cv'      → counted by on-device pose detection (push-ups today)
  -- 'manual'  → participant types the number (reading, prayer, steps, walks…)
  tracking_mode   text not null default 'manual' check (tracking_mode in ('cv','manual')),
  unit            text not null default 'reps' check (char_length(unit) between 1 and 16),
  daily_target    integer not null check (daily_target between 1 and 100000),
  max_daily_entry integer not null default 2000 check (max_daily_entry between 1 and 1000000),
  start_date      date not null,
  end_date        date not null,
  visibility      text not null check (visibility in ('private','public')),
  timezone        text not null default 'Africa/Lagos',
  description     text check (char_length(description) <= 280),
  created_at      timestamptz not null default now(),
  constraint challenges_date_order check (end_date >= start_date),
  constraint challenges_length_sane check (end_date - start_date <= 366)
);

create index if not exists challenges_public_idx
  on public.challenges (created_at desc) where visibility = 'public';
create index if not exists challenges_creator_idx on public.challenges (creator_id);

create table if not exists public.participants (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references public.challenges(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  nickname      text not null check (char_length(btrim(nickname)) between 1 and 24),
  joined_at     timestamptz not null default now(),
  unique (challenge_id, user_id)
);

create index if not exists participants_challenge_idx on public.participants (challenge_id);
create index if not exists participants_user_idx on public.participants (user_id);

create table if not exists public.workouts (
  id            uuid primary key default gen_random_uuid(),
  challenge_id  uuid not null references public.challenges(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  workout_date  date not null,
  count         integer not null check (count >= 0),
  source        text not null default 'cv' check (source in ('cv','manual')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (challenge_id, user_id, workout_date)
);

create index if not exists workouts_challenge_date_idx
  on public.workouts (challenge_id, workout_date desc);
create index if not exists workouts_user_idx on public.workouts (challenge_id, user_id);

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER: used inside policies, must not re-trigger RLS)
-- ---------------------------------------------------------------------------

create or replace function public.is_participant(p_challenge_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.participants
    where challenge_id = p_challenge_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_challenge_owner(p_challenge_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.challenges
    where id = p_challenge_id and creator_id = auth.uid()
  );
$$;

-- Today's date in the challenge's own timezone. Streaks and "today" everywhere
-- must agree on this, so it is computed in exactly one place.
create or replace function public.challenge_today(p_challenge_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (now() at time zone c.timezone)::date
  from public.challenges c where c.id = p_challenge_id;
$$;

-- Unambiguous alphabet: no O/0, I/1, S/5, Z/2 — these get read aloud over
-- WhatsApp and typed by hand.
create or replace function public.generate_challenge_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRTUVWXY346789';
  candidate text;
  i integer;
  attempts integer := 0;
begin
  loop
    candidate := '';
    for i in 1..6 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.challenges where code = candidate);
    attempts := attempts + 1;
    if attempts > 50 then
      raise exception 'could not allocate a unique challenge code';
    end if;
  end loop;
  return candidate;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists workouts_touch_updated_at on public.workouts;
create trigger workouts_touch_updated_at
  before update on public.workouts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.users        enable row level security;
alter table public.challenges   enable row level security;
alter table public.participants enable row level security;
alter table public.workouts     enable row level security;

-- users -----------------------------------------------------------------
drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select using (id = auth.uid());

drop policy if exists users_upsert_self on public.users;
create policy users_upsert_self on public.users
  for insert with check (id = auth.uid());

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  for update using (id = auth.uid()) with check (id = auth.uid());

-- challenges ------------------------------------------------------------
-- Public challenges are readable by anyone signed in. Private ones are
-- readable only by their creator and their participants — so /explore and a
-- brute-force scan of the table can never surface a private challenge.
drop policy if exists challenges_select on public.challenges;
create policy challenges_select on public.challenges
  for select using (
    visibility = 'public'
    or creator_id = auth.uid()
    or public.is_participant(id)
  );

drop policy if exists challenges_insert on public.challenges;
create policy challenges_insert on public.challenges
  for insert with check (creator_id = auth.uid());

drop policy if exists challenges_update_owner on public.challenges;
create policy challenges_update_owner on public.challenges
  for update using (creator_id = auth.uid()) with check (creator_id = auth.uid());

drop policy if exists challenges_delete_owner on public.challenges;
create policy challenges_delete_owner on public.challenges
  for delete using (creator_id = auth.uid());

-- participants ----------------------------------------------------------
-- You can see the roster of any challenge you are in, or that you own.
drop policy if exists participants_select on public.participants;
create policy participants_select on public.participants
  for select using (
    user_id = auth.uid()
    or public.is_participant(challenge_id)
    or public.is_challenge_owner(challenge_id)
  );

-- Direct inserts are allowed only for challenges you can already see
-- (i.e. public ones). Private joins go through join_challenge(code, nickname).
drop policy if exists participants_insert_self on public.participants;
create policy participants_insert_self on public.participants
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.challenges c
      where c.id = challenge_id and c.visibility = 'public'
    )
  );

drop policy if exists participants_update_self on public.participants;
create policy participants_update_self on public.participants
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Leaving a challenge, or an organizer removing someone.
drop policy if exists participants_delete on public.participants;
create policy participants_delete on public.participants
  for delete using (user_id = auth.uid() or public.is_challenge_owner(challenge_id));

-- workouts --------------------------------------------------------------
drop policy if exists workouts_select on public.workouts;
create policy workouts_select on public.workouts
  for select using (
    user_id = auth.uid()
    or public.is_participant(challenge_id)
    or public.is_challenge_owner(challenge_id)
  );

-- Writes are the only place cheating is cheap, so every guard lives here:
-- own row, actually a participant, date inside the challenge window, date not
-- in the future in the challenge's timezone, and count within the cap.
drop policy if exists workouts_insert_self on public.workouts;
create policy workouts_insert_self on public.workouts
  for insert with check (
    user_id = auth.uid()
    and public.is_participant(challenge_id)
    and exists (
      select 1 from public.challenges c
      where c.id = challenge_id
        and workout_date between c.start_date and c.end_date
        and workout_date <= (now() at time zone c.timezone)::date
        and count <= c.max_daily_entry
    )
  );

drop policy if exists workouts_update_self on public.workouts;
create policy workouts_update_self on public.workouts
  for update
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.challenges c
      where c.id = challenge_id
        and workout_date between c.start_date and c.end_date
        and workout_date <= (now() at time zone c.timezone)::date
        and count <= c.max_daily_entry
    )
  );

-- No delete policy: a synced workout cannot be removed by the client.

-- ---------------------------------------------------------------------------
-- RPCs the client actually calls
-- ---------------------------------------------------------------------------

-- Look up a challenge by code, including private ones. Returns only the
-- fields needed to render the join screen — never the participant list.
create or replace function public.get_challenge_by_code(p_code text)
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
  visibility text,
  timezone text,
  description text,
  participant_count bigint,
  creator_nickname text,
  already_joined boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.name, c.code, c.activity_type, c.tracking_mode, c.unit,
    c.daily_target, c.start_date, c.end_date, c.visibility, c.timezone,
    c.description,
    (select count(*) from public.participants p where p.challenge_id = c.id),
    (select u.nickname from public.users u where u.id = c.creator_id),
    exists (
      select 1 from public.participants p
      where p.challenge_id = c.id and p.user_id = auth.uid()
    )
  from public.challenges c
  where c.code = upper(btrim(p_code));
$$;

-- Create a challenge and allocate its code in one round trip.
create or replace function public.create_challenge(
  p_name text,
  p_activity_type text,
  p_tracking_mode text,
  p_unit text,
  p_daily_target integer,
  p_start_date date,
  p_end_date date,
  p_visibility text,
  p_timezone text,
  p_nickname text,
  p_description text default null
)
returns public.challenges
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_challenge public.challenges;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  insert into public.users (id, nickname)
  values (v_uid, btrim(p_nickname))
  on conflict (id) do update set nickname = excluded.nickname;

  insert into public.challenges (
    name, code, creator_id, activity_type, tracking_mode, unit,
    daily_target, start_date, end_date, visibility, timezone, description
  ) values (
    btrim(p_name), public.generate_challenge_code(), v_uid,
    p_activity_type, p_tracking_mode, p_unit,
    p_daily_target, p_start_date, p_end_date, p_visibility,
    coalesce(nullif(btrim(p_timezone), ''), 'Africa/Lagos'),
    nullif(btrim(coalesce(p_description, '')), '')
  )
  returning * into v_challenge;

  -- The organizer is a participant too; nobody wants to join their own challenge.
  insert into public.participants (challenge_id, user_id, nickname)
  values (v_challenge.id, v_uid, btrim(p_nickname))
  on conflict do nothing;

  return v_challenge;
end;
$$;

-- Join by code. SECURITY DEFINER so a private challenge can be joined by
-- someone holding the code without that challenge ever being readable to them
-- before they join.
create or replace function public.join_challenge(p_code text, p_nickname text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_challenge_id uuid;
  v_nick text := btrim(p_nickname);
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if char_length(v_nick) < 1 or char_length(v_nick) > 24 then
    raise exception 'nickname must be 1-24 characters';
  end if;

  select id into v_challenge_id
  from public.challenges where code = upper(btrim(p_code));

  if v_challenge_id is null then
    raise exception 'challenge not found' using errcode = 'P0002';
  end if;

  insert into public.users (id, nickname)
  values (v_uid, v_nick)
  on conflict (id) do update set nickname = excluded.nickname;

  insert into public.participants (challenge_id, user_id, nickname)
  values (v_challenge_id, v_uid, v_nick)
  on conflict (challenge_id, user_id) do update set nickname = excluded.nickname;

  return v_challenge_id;
end;
$$;

-- Idempotent workout upsert. The client always sends the FINAL daily total,
-- so a replayed offline queue item can never double-count. When two devices
-- disagree we keep the larger number rather than letting the last writer win
-- and silently erase reps the participant actually did.
create or replace function public.save_workout(
  p_challenge_id uuid,
  p_workout_date date,
  p_count integer,
  p_source text default 'cv'
)
returns public.workouts
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_challenge public.challenges;
  v_row public.workouts;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_challenge from public.challenges where id = p_challenge_id;
  if v_challenge is null then
    raise exception 'challenge not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.participants
    where challenge_id = p_challenge_id and user_id = v_uid
  ) then
    raise exception 'not a participant of this challenge';
  end if;

  if p_count < 0 or p_count > v_challenge.max_daily_entry then
    raise exception 'count out of range (0..%)', v_challenge.max_daily_entry;
  end if;

  if p_workout_date < v_challenge.start_date or p_workout_date > v_challenge.end_date then
    raise exception 'date outside the challenge window';
  end if;

  if p_workout_date > (now() at time zone v_challenge.timezone)::date then
    raise exception 'cannot log a future date';
  end if;

  insert into public.workouts (challenge_id, user_id, workout_date, count, source)
  values (p_challenge_id, v_uid, p_workout_date, p_count, coalesce(p_source, 'cv'))
  on conflict (challenge_id, user_id, workout_date) do update
    set count = greatest(public.workouts.count, excluded.count),
        source = excluded.source
  returning * into v_row;

  return v_row;
end;
$$;

-- Public discovery. Never touches private rows.
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

-- Leaderboard: totals, completed days and current/longest streak per
-- participant, computed server-side in one pass.
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

-- One participant's full daily history, for the calendar and progress views.
create or replace function public.get_my_history(p_challenge_id uuid)
returns table (workout_date date, count integer, met_target boolean)
language sql
stable
security definer
set search_path = public
as $$
  select w.workout_date, w.count, w.count >= c.daily_target
  from public.workouts w
  join public.challenges c on c.id = w.challenge_id
  where w.challenge_id = p_challenge_id
    and w.user_id = auth.uid()
  order by w.workout_date desc;
$$;

-- Every challenge the current user belongs to, for the "my challenges" list.
create or replace function public.get_my_challenges()
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
  visibility text,
  timezone text,
  is_owner boolean,
  today_count integer,
  participant_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id, c.name, c.code, c.activity_type, c.tracking_mode, c.unit,
    c.daily_target, c.start_date, c.end_date, c.visibility, c.timezone,
    c.creator_id = auth.uid(),
    coalesce((
      select w.count from public.workouts w
      where w.challenge_id = c.id and w.user_id = auth.uid()
        and w.workout_date = (now() at time zone c.timezone)::date
    ), 0),
    (select count(*) from public.participants p2 where p2.challenge_id = c.id)
  from public.challenges c
  join public.participants p on p.challenge_id = c.id and p.user_id = auth.uid()
  order by c.end_date >= current_date desc, c.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.generate_challenge_code() from public, anon, authenticated;

grant execute on function
  public.get_challenge_by_code(text),
  public.create_challenge(text,text,text,text,integer,date,date,text,text,text,text),
  public.join_challenge(text,text),
  public.save_workout(uuid,date,integer,text),
  public.get_public_challenges(text,integer,integer),
  public.get_leaderboard(uuid),
  public.get_my_history(uuid),
  public.get_my_challenges(),
  public.challenge_today(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- Clients subscribe to workouts filtered by challenge_id, never to the whole
-- table. RLS still applies to realtime payloads.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'workouts'
  ) then
    alter publication supabase_realtime add table public.workouts;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'participants'
  ) then
    alter publication supabase_realtime add table public.participants;
  end if;
end $$;
