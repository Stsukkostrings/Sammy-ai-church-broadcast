-- Omnicast tenant schema. Safe to apply repeatedly. This migration never
-- deletes application rows and never assigns legacy records to a guessed user.
begin;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.omnicast_create_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'))
  on conflict (user_id) do update set
    email = excluded.email,
    display_name = coalesce(excluded.display_name, public.profiles.display_name),
    updated_at = now();
  return new;
end;
$$;
revoke all on function public.omnicast_create_profile() from public, anon, authenticated;
drop trigger if exists omnicast_auth_user_profile on auth.users;
create trigger omnicast_auth_user_profile after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.omnicast_create_profile();

-- Existing sign-in identities predate this profile table. Backfill safely and
-- idempotently when this migration is deliberately applied to the dev project.
insert into public.profiles (user_id, email, display_name)
select id, email, coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name')
from auth.users
on conflict (user_id) do update set
  email = excluded.email,
  display_name = coalesce(excluded.display_name, public.profiles.display_name),
  updated_at = now();

create table if not exists public.youtube_channels (
  user_id uuid not null references auth.users(id) on delete cascade,
  channel_id text not null,
  channel_title text,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  token_expires_at timestamptz not null,
  last_synced_at timestamptz,
  last_sync_count integer not null default 0,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

create table if not exists public.comments (
  user_id uuid not null,
  channel_id text not null,
  comment_id text not null,
  video_id text,
  video_title text not null default '',
  author_display_name text not null default '',
  author_channel_id text,
  text text not null default '',
  published_at timestamptz,
  like_count integer not null default 0,
  can_reply boolean not null default false,
  total_reply_count integer not null default 0,
  replies jsonb not null default '[]'::jsonb,
  category text,
  language text,
  flagged boolean not null default false,
  status text not null default 'unanswered',
  replied boolean not null default false,
  publish_status text not null default 'idle',
  reply_id text,
  synced_at timestamptz not null default now(),
  primary key (user_id, channel_id, comment_id),
  constraint comments_owned_channel foreign key (user_id, channel_id)
    references public.youtube_channels(user_id, channel_id) on delete cascade
);

-- Additive columns for installations that already have the first version of
-- this schema. CREATE TABLE IF NOT EXISTS deliberately cannot alter an
-- existing table, so these statements make the upgrade safe and idempotent.
alter table public.comments add column if not exists text_display text;
alter table public.comments add column if not exists text_original text;
alter table public.comments add column if not exists replies_incomplete boolean not null default false;
alter table public.comments add column if not exists has_owner_reply boolean not null default false;
alter table public.comments add column if not exists owner_reply_id text;
alter table public.comments add column if not exists publish_claimed_at timestamptz;
update public.comments set text_display = coalesce(text_display, text), text_original = coalesce(text_original, text)
where text_display is null or text_original is null;

create table if not exists public.comment_drafts (
  user_id uuid not null,
  channel_id text not null,
  comment_id text not null,
  text text not null,
  status text not null default 'draft',
  edited boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, channel_id, comment_id),
  constraint drafts_owned_comment foreign key (user_id, channel_id, comment_id)
    references public.comments(user_id, channel_id, comment_id) on delete cascade
);

create table if not exists public.published_replies (
  user_id uuid not null,
  channel_id text not null,
  comment_id text not null,
  reply_id text not null,
  text text not null,
  published_at timestamptz not null default now(),
  primary key (user_id, channel_id, comment_id),
  unique (user_id, channel_id, reply_id),
  constraint published_owned_comment foreign key (user_id, channel_id, comment_id)
    references public.comments(user_id, channel_id, comment_id) on delete cascade
);

create table if not exists public.user_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Distributed limits for AI, synchronization and publishing. The table is
-- intentionally not readable or writable by API clients; access is only
-- through the authenticated SECURITY DEFINER function below.
create table if not exists public.rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  expires_at timestamptz not null,
  primary key (user_id, bucket)
);

create index if not exists comments_owner_channel_date_idx on public.comments (user_id, channel_id, published_at desc);
create index if not exists published_owner_channel_date_idx on public.published_replies (user_id, channel_id, published_at desc);
create index if not exists rate_limits_expiry_idx on public.rate_limits (expires_at);

alter table public.profiles enable row level security;
alter table public.youtube_channels enable row level security;
alter table public.comments enable row level security;
alter table public.comment_drafts enable row level security;
alter table public.published_replies enable row level security;
alter table public.user_settings enable row level security;
alter table public.rate_limits enable row level security;

drop policy if exists profiles_owner_all on public.profiles;
create policy profiles_owner_all on public.profiles for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);
drop policy if exists channels_owner_all on public.youtube_channels;
create policy channels_owner_all on public.youtube_channels for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);
drop policy if exists comments_owner_all on public.comments;
create policy comments_owner_all on public.comments for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);
drop policy if exists drafts_owner_all on public.comment_drafts;
create policy drafts_owner_all on public.comment_drafts for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);
drop policy if exists published_owner_all on public.published_replies;
create policy published_owner_all on public.published_replies for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);
drop policy if exists settings_owner_all on public.user_settings;
create policy settings_owner_all on public.user_settings for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

grant select, insert, update, delete on public.profiles, public.youtube_channels,
  public.comments, public.comment_drafts, public.published_replies, public.user_settings to authenticated;
grant usage on schema public to authenticated;
-- No anon policy and no service-role key is used by application requests.

revoke all on public.rate_limits from public, anon, authenticated;

create or replace function public.consume_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
returns table(allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_count integer;
  v_reset timestamptz;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_bucket is null or length(p_bucket) < 1 or length(p_bucket) > 64
     or p_limit is null or p_limit < 1 or p_limit > 1000
     or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit parameters' using errcode = '22023';
  end if;

  v_window_start := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  v_reset := v_window_start + make_interval(secs => p_window_seconds);

  insert into public.rate_limits as rl (user_id, bucket, window_start, count, expires_at)
  values (v_user, p_bucket, v_window_start, 1, v_reset)
  on conflict (user_id, bucket) do update set
    count = case when rl.window_start < excluded.window_start then 1 else rl.count + 1 end,
    window_start = case when rl.window_start < excluded.window_start then excluded.window_start else rl.window_start end,
    expires_at = case when rl.window_start < excluded.window_start then excluded.expires_at else rl.expires_at end
  returning rl.count, rl.window_start, rl.expires_at into v_count, v_window_start, v_reset;

  allowed := v_count <= p_limit;
  remaining := greatest(p_limit - v_count, 0);
  reset_at := v_reset;
  return next;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon;
grant execute on function public.consume_rate_limit(text, integer, integer) to authenticated;

create or replace function public.claim_comment_publish(p_channel_id text, p_comment_id text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare claimed_count integer;
begin
  update public.comments c set publish_status = 'publishing', publish_claimed_at = now()
  where c.user_id = auth.uid() and c.channel_id = p_channel_id and c.comment_id = p_comment_id
    and c.replied = false and c.publish_status in ('idle', 'draft')
    and not exists (select 1 from public.published_replies p
      where p.user_id = auth.uid() and p.channel_id = p_channel_id and p.comment_id = p_comment_id);
  get diagnostics claimed_count = row_count;
  return claimed_count > 0;
end;
$$;

create or replace function public.release_comment_publish(p_channel_id text, p_comment_id text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.comments set publish_status = 'idle', publish_claimed_at = null
  where user_id = auth.uid() and channel_id = p_channel_id and comment_id = p_comment_id
    and publish_status in ('publishing', 'reconciliation_required', 'uncertain');
end;
$$;

create or replace function public.complete_comment_publish(p_channel_id text, p_comment_id text, p_reply_id text, p_text text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_reply_id is null or length(p_reply_id) < 1 or p_text is null or length(p_text) < 1 then
    raise exception 'invalid publish result' using errcode = '22023';
  end if;

  insert into public.published_replies (user_id, channel_id, comment_id, reply_id, text)
  select auth.uid(), p_channel_id, p_comment_id, p_reply_id, p_text
  where exists (select 1 from public.comments c where c.user_id = auth.uid()
    and c.channel_id = p_channel_id and c.comment_id = p_comment_id
    and c.publish_status in ('publishing', 'reconciliation_required', 'uncertain'))
  on conflict (user_id, channel_id, comment_id) do update set
    reply_id = excluded.reply_id,
    text = excluded.text;
  if not found then raise exception 'comment is not eligible to publish' using errcode = '42501'; end if;

  update public.comments set replied = true, reply_id = p_reply_id,
    status = 'published', publish_status = 'published', publish_claimed_at = null
  where user_id = auth.uid() and channel_id = p_channel_id and comment_id = p_comment_id;
end;
$$;

create or replace function public.recover_stale_publish(p_channel_id text, p_comment_id text, p_stale_after_seconds integer)
returns integer language plpgsql security invoker set search_path = '' as $$
declare recovered_count integer;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_stale_after_seconds is null or p_stale_after_seconds < 30 or p_stale_after_seconds > 3600 then
    raise exception 'invalid stale window' using errcode = '22023';
  end if;
  update public.comments set publish_status = 'reconciliation_required'
  where user_id = auth.uid()
    and (p_channel_id is null or channel_id = p_channel_id)
    and (p_comment_id is null or comment_id = p_comment_id)
    and publish_status = 'publishing'
    and coalesce(publish_claimed_at, synced_at) < now() - make_interval(secs => p_stale_after_seconds);
  get diagnostics recovered_count = row_count;
  return recovered_count;
end;
$$;

revoke all on function public.claim_comment_publish(text, text), public.release_comment_publish(text, text),
  public.complete_comment_publish(text, text, text, text),
  public.recover_stale_publish(text, text, integer) from public, anon;
grant execute on function public.claim_comment_publish(text, text), public.release_comment_publish(text, text),
  public.complete_comment_publish(text, text, text, text),
  public.recover_stale_publish(text, text, integer) to authenticated;

commit;
