-- Bible Peruser — reader-submitted label/highlight suggestions.
-- Lives in the shared Gospel Go Supabase project (single auth.users across
-- all games) — every object here is bp_-prefixed to stay isolated from the
-- other games' schemas. Apply with mcp__supabase__apply_migration (name:
-- bp_suggestions_init), then verify with mcp__supabase__get_advisors.
--
-- Design notes (see CLAUDE.md's Suggestions section for the full story):
--  * bp_admins / bp_banned_users / bp_settings carry NO RLS policies at
--    all — they are invisible to every client key (anon or authenticated)
--    and reachable only through the SECURITY DEFINER functions below (or
--    the service role, used by scripts/apply-approved-suggestions.js).
--    Admin mutations against them go through bp_ban_user() /
--    bp_set_suggestions_enabled(), not direct table access, so there's
--    never a need to grant a broad UPDATE policy on them.
--  * bp_suggestions is the only table a normal client touches directly.

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table if not exists public.bp_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.bp_admins enable row level security;

create table if not exists public.bp_banned_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  reason     text,
  banned_by  uuid references auth.users(id),
  banned_at  timestamptz not null default now()
);
alter table public.bp_banned_users enable row level security;

create table if not exists public.bp_settings (
  key   text primary key,
  value jsonb not null
);
alter table public.bp_settings enable row level security;

insert into public.bp_settings (key, value)
values ('suggestions_enabled', 'true'::jsonb)
on conflict (key) do nothing;

create table if not exists public.bp_suggestions (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  user_email    text,

  scope         text not null check (scope in ('chapter', 'bookwide')),
  book_id       text not null check (book_id ~ '^[A-Z0-9]{3}$'),
  chapter       int,
  entry_kind    text not null check (entry_kind in ('label', 'highlight')),
  action        text not null check (action in ('add', 'correct')),

  target        jsonb,
  proposed      jsonb not null,
  rationale     text check (char_length(rationale) <= 1000),

  status        text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'applied', 'unmatched')),
  reviewed_at   timestamptz,
  reviewed_by   uuid references auth.users(id),
  review_note   text check (char_length(review_note) <= 1000),
  applied_at    timestamptz,

  content_hash  text not null,

  constraint bp_sugg_chapter_shape check (
    (scope = 'chapter'  and chapter between 1 and 150) or
    (scope = 'bookwide' and chapter is null)
  ),
  constraint bp_sugg_target_shape check (
    (action = 'add' and target is null) or (action = 'correct' and target is not null)
  ),
  constraint bp_sugg_size check (
    length(proposed::text) <= 8000 and (target is null or length(target::text) <= 8000)
  ),
  constraint bp_sugg_no_links check (not (proposed ? 'links'))
);
alter table public.bp_suggestions enable row level security;

create index if not exists bp_sugg_status_idx on public.bp_suggestions (status, created_at desc);
create index if not exists bp_sugg_user_idx   on public.bp_suggestions (user_id, created_at desc);
create index if not exists bp_sugg_locate_idx on public.bp_suggestions (book_id, chapter, status);

-- Best-effort global dedup: two people can't have the identical change
-- pending at once. Scoped to 'pending' so a rejected-then-improved
-- resubmission is never permanently blocked.
create unique index if not exists bp_sugg_pending_dupe
  on public.bp_suggestions (content_hash) where status = 'pending';

-- ---------------------------------------------------------------------
-- SECURITY DEFINER helper functions
-- ---------------------------------------------------------------------

create or replace function public.bp_is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.bp_admins a where a.user_id = auth.uid())
$$;
revoke all on function public.bp_is_admin() from public;
grant execute on function public.bp_is_admin() to authenticated;

create or replace function public.bp_is_banned() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.bp_banned_users b where b.user_id = auth.uid())
$$;
revoke all on function public.bp_is_banned() from public;
grant execute on function public.bp_is_banned() to authenticated;

create or replace function public.bp_suggestions_enabled() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select (value #>> '{}')::boolean from public.bp_settings where key = 'suggestions_enabled'),
    true
  )
$$;
revoke all on function public.bp_suggestions_enabled() from public;
grant execute on function public.bp_suggestions_enabled() to authenticated, anon;

-- Admin-only mutations, invoked via rpc() from js/bp-admin.js. Each checks
-- bp_is_admin() itself rather than relying solely on grants, so calling
-- them as a non-admin fails loudly instead of silently no-op-ing.
create or replace function public.bp_ban_user(target_user_id uuid, ban_reason text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.bp_is_admin() then
    raise exception 'BP_NOT_ADMIN' using errcode = '42501';
  end if;
  insert into public.bp_banned_users (user_id, reason, banned_by)
  values (target_user_id, ban_reason, auth.uid())
  on conflict (user_id) do update set reason = excluded.reason;
end;
$$;
revoke all on function public.bp_ban_user(uuid, text) from public;
grant execute on function public.bp_ban_user(uuid, text) to authenticated;

create or replace function public.bp_unban_user(target_user_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.bp_is_admin() then
    raise exception 'BP_NOT_ADMIN' using errcode = '42501';
  end if;
  delete from public.bp_banned_users where user_id = target_user_id;
end;
$$;
revoke all on function public.bp_unban_user(uuid) from public;
grant execute on function public.bp_unban_user(uuid) to authenticated;

create or replace function public.bp_set_suggestions_enabled(enabled boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.bp_is_admin() then
    raise exception 'BP_NOT_ADMIN' using errcode = '42501';
  end if;
  insert into public.bp_settings (key, value)
  values ('suggestions_enabled', to_jsonb(enabled))
  on conflict (key) do update set value = excluded.value;
end;
$$;
revoke all on function public.bp_set_suggestions_enabled(boolean) from public;
grant execute on function public.bp_set_suggestions_enabled(boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Insert guard trigger: the single enforcement point for everything a
-- client cannot be trusted to set correctly (identity, moderation status,
-- kill switch, ban, spam limits, dedup hash).
-- ---------------------------------------------------------------------

create or replace function public.bp_suggestions_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pending_n int;
  daily_n   int;
begin
  new.user_id     := auth.uid();
  new.user_email  := auth.jwt() ->> 'email';
  new.status      := 'pending';
  new.reviewed_at := null;
  new.reviewed_by := null;
  new.review_note := null;
  new.applied_at  := null;

  if new.user_id is null then
    raise exception 'BP_AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if not public.bp_suggestions_enabled() then
    raise exception 'BP_SUGGESTIONS_DISABLED' using errcode = 'P0001';
  end if;

  if public.bp_is_banned() then
    raise exception 'BP_BANNED' using errcode = 'P0001';
  end if;

  if new.proposed::text ~* '(https?://|www\.)' or coalesce(new.rationale, '') ~* '(https?://|www\.)' then
    raise exception 'BP_NO_LINKS' using errcode = 'P0001';
  end if;

  select count(*) into pending_n from public.bp_suggestions
    where user_id = new.user_id and status = 'pending';
  if pending_n >= 5 then
    raise exception 'BP_RATE_PENDING' using errcode = 'P0001';
  end if;

  select count(*) into daily_n from public.bp_suggestions
    where user_id = new.user_id and created_at > now() - interval '24 hours';
  if daily_n >= 10 then
    raise exception 'BP_RATE_DAILY' using errcode = 'P0001';
  end if;

  new.content_hash := md5(
    new.scope || '|' || new.book_id || '|' || coalesce(new.chapter::text, '') || '|' ||
    new.entry_kind || '|' || new.action || '|' ||
    lower(coalesce(new.target ->> 'entry_name', '')) || '|' ||
    lower(regexp_replace(new.proposed::text, '\s+', ' ', 'g'))
  );

  return new;
end;
$$;

drop trigger if exists bp_suggestions_guard_trg on public.bp_suggestions;
create trigger bp_suggestions_guard_trg
  before insert on public.bp_suggestions
  for each row execute function public.bp_suggestions_guard();

-- ---------------------------------------------------------------------
-- RLS policies on bp_suggestions
-- ---------------------------------------------------------------------

drop policy if exists bp_sugg_insert_own on public.bp_suggestions;
create policy bp_sugg_insert_own on public.bp_suggestions
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists bp_sugg_select_own_or_admin on public.bp_suggestions;
create policy bp_sugg_select_own_or_admin on public.bp_suggestions
  for select to authenticated
  using (user_id = auth.uid() or public.bp_is_admin());

drop policy if exists bp_sugg_update_admin on public.bp_suggestions;
create policy bp_sugg_update_admin on public.bp_suggestions
  for update to authenticated
  using (public.bp_is_admin())
  with check (public.bp_is_admin());

-- No delete policy anywhere: nothing user-facing can ever destroy a row.

grant select, insert, update on public.bp_suggestions to authenticated;

-- ---------------------------------------------------------------------
-- Seed the first admin. Replace the uid below (find it via
-- `select id, email from auth.users where email = '...'`) before applying,
-- or run this insert separately once the owner's uid is known.
-- ---------------------------------------------------------------------
-- insert into public.bp_admins (user_id, note) values ('<owner-uid>', 'site owner')
--   on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------
-- Public leaderboard: approved-suggestion counts by contributor.
-- Modeled on the other Gospel Go games' bubble_top_overall() precedent —
-- LEFT JOIN the shared `usernames` table (userid stored as text; note the
-- ::text cast) with the same 'Add username in Profile' display fallback,
-- callable by anon (public leaderboard, no sign-in required, matching
-- convention). Applied via mcp__supabase__apply_migration.
-- ---------------------------------------------------------------------

create or replace function public.bp_top_contributors(limit_n integer default 20)
returns table(display_name text, approved_count bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select
    case
      when u.username is not null and u.username <> '' then u.username::text
      else 'Add username in Profile'
    end as display_name,
    count(*) as approved_count
  from public.bp_suggestions s
  left join public.usernames u on u.userid = s.user_id::text
  where s.status = 'approved'
  group by s.user_id, u.username
  order by approved_count desc
  limit limit_n;
$$;
revoke all on function public.bp_top_contributors(integer) from public;
grant execute on function public.bp_top_contributors(integer) to authenticated, anon;
