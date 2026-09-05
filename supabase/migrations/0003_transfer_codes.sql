-- ============================================================================
-- Showup — 0003: portable identity (transfer codes)
--
-- Why this exists:
--   Adding a web app to the iOS home screen gives it a storage container that
--   is completely separate from Safari's. The anonymous identity, the cached
--   challenges and the local workouts all live in Safari's container, so the
--   installed app starts empty and the participant is asked to join from
--   scratch after a week of use. There is no API to share that storage.
--
--   So the identity is made portable instead: a short-lived, single-use code
--   that moves a participant's rows from their old anonymous user to whichever
--   anonymous user is asking. This also covers "I got a new phone", which was
--   otherwise a permanent dead end for an account with no password.
--
-- Security shape:
--   * codes are single-use and expire in 30 minutes
--   * a code is a bearer credential, so it is short-lived by design and one
--     outstanding code per user - issuing a new one invalidates the old
--   * the table is never readable by clients; both entry points are
--     SECURITY DEFINER functions
--
-- Safe to run on an existing database.
-- ============================================================================

create table if not exists public.transfer_codes (
  code        text primary key check (code ~ '^[A-Z0-9]{8}$'),
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create index if not exists transfer_codes_user_idx on public.transfer_codes (user_id);

alter table public.transfer_codes enable row level security;
-- Deliberately no policies: nothing reaches this table except through the
-- SECURITY DEFINER functions below.

-- ---------------------------------------------------------------------------
-- Issue a code
-- ---------------------------------------------------------------------------

create or replace function public.create_transfer_code()
returns table (code text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRTUVWXY346789';
  v_uid uuid := auth.uid();
  v_code text;
  i integer;
  attempts integer := 0;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- One outstanding code per user: issuing a new one retires the old.
  delete from public.transfer_codes t where t.user_id = v_uid and t.used_at is null;

  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.transfer_codes t where t.code = v_code);
    attempts := attempts + 1;
    if attempts > 50 then
      raise exception 'could not allocate a transfer code';
    end if;
  end loop;

  insert into public.transfer_codes (code, user_id, expires_at)
  values (v_code, v_uid, now() + interval '30 minutes');

  return query select v_code, now() + interval '30 minutes';
end;
$$;

-- ---------------------------------------------------------------------------
-- Redeem a code: move everything to the caller
-- ---------------------------------------------------------------------------

create or replace function public.claim_transfer(p_code text)
returns table (challenges_moved integer, workouts_moved integer, nickname text)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_new uuid := auth.uid();
  v_old uuid;
  v_nickname text;
  v_ch integer := 0;
  v_wk integer := 0;
  r record;
begin
  if v_new is null then
    raise exception 'not authenticated';
  end if;

  select t.user_id into v_old
  from public.transfer_codes t
  where t.code = upper(btrim(p_code))
    and t.used_at is null
    and t.expires_at > now()
  for update;

  if v_old is null then
    raise exception 'that transfer code is not valid or has expired'
      using errcode = 'P0002';
  end if;

  -- Burn the code before doing anything else.
  update public.transfer_codes t set used_at = now() where t.code = upper(btrim(p_code));

  if v_old = v_new then
    select u.nickname into v_nickname from public.users u where u.id = v_new;
    return query select 0, 0, coalesce(v_nickname, '');
    return;
  end if;

  select u.nickname into v_nickname from public.users u where u.id = v_old;

  -- Challenges this person organises follow them.
  update public.challenges c set creator_id = v_new where c.creator_id = v_old;

  -- Memberships. If the caller somehow already joined the same challenge,
  -- keep the earlier join date rather than creating a duplicate.
  for r in select * from public.participants p where p.user_id = v_old loop
    insert into public.participants (challenge_id, user_id, nickname, joined_at)
    values (r.challenge_id, v_new, r.nickname, r.joined_at)
    on conflict (challenge_id, user_id) do update
      set joined_at = least(public.participants.joined_at, excluded.joined_at),
          nickname = excluded.nickname;
    v_ch := v_ch + 1;
  end loop;

  -- Daily totals. Same rule as save_workout: on a clash the larger count
  -- wins, so a transfer can never erase reps someone actually did.
  for r in select * from public.workouts w where w.user_id = v_old loop
    insert into public.workouts (challenge_id, user_id, workout_date, count, source)
    values (r.challenge_id, v_new, r.workout_date, r.count, r.source)
    on conflict (challenge_id, user_id, workout_date) do update
      set count = greatest(public.workouts.count, excluded.count),
          source = excluded.source;
    v_wk := v_wk + 1;
  end loop;

  delete from public.workouts w where w.user_id = v_old;
  delete from public.participants p where p.user_id = v_old;

  if v_nickname is not null then
    insert into public.users (id, nickname)
    values (v_new, v_nickname)
    on conflict (id) do update set nickname = excluded.nickname;
  end if;

  return query select v_ch, v_wk, coalesce(v_nickname, '');
end;
$$;

grant execute on function public.create_transfer_code() to authenticated;
grant execute on function public.claim_transfer(text) to authenticated;

-- Housekeeping: expired codes are worthless. Called opportunistically by
-- create_transfer_code callers rather than needing a scheduled job.
create or replace function public.purge_expired_transfer_codes()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  delete from public.transfer_codes
  where expires_at < now() - interval '1 day';
$$;
