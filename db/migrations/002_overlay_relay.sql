-- Secure server-backed OBS relay. Safe to apply repeatedly; no existing rows
-- are deleted, reassigned, or rewritten. The Node runtime generates the token
-- and sends only its SHA-256 hash to Postgres. Anonymous OBS readers can call
-- exactly one read-only SECURITY DEFINER function and have no table grants.
begin;

create table if not exists public.overlay_channels (
  user_id uuid not null references auth.users(id) on delete cascade,
  overlay_key text not null,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 0 check (revision >= 0),
  token_hash text,
  token_created_at timestamptz,
  token_rotated_at timestamptz,
  token_revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, overlay_key),
  constraint overlay_key_allowed check (overlay_key in ('lower-third', 'church')),
  constraint overlay_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint overlay_payload_size check (octet_length(payload::text) <= 16384),
  constraint overlay_token_hash_format check (token_hash is null or token_hash ~ '^[a-f0-9]{64}$')
);

-- A nullable unique index allows any number of revoked channels while ensuring
-- one active hash can only ever identify one owner/channel.
create unique index if not exists overlay_channels_token_hash_idx
  on public.overlay_channels(token_hash)
  where token_hash is not null;

alter table public.overlay_channels enable row level security;

drop policy if exists overlay_channels_owner_all on public.overlay_channels;
create policy overlay_channels_owner_all on public.overlay_channels for all to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

grant select, insert, update, delete on public.overlay_channels to authenticated;
revoke all on public.overlay_channels from public, anon;
grant usage on schema public to anon;

create or replace function public.publish_overlay(p_overlay_key text, p_payload jsonb)
returns table(revision bigint, updated_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_revision bigint;
  v_updated_at timestamptz;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_overlay_key is null or p_overlay_key not in ('lower-third', 'church') then
    raise exception 'invalid overlay key' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 16384 then
    raise exception 'invalid overlay payload' using errcode = '22023';
  end if;

  insert into public.overlay_channels as oc (user_id, overlay_key, payload, revision, updated_at)
  values (v_user, p_overlay_key, p_payload, 1, now())
  on conflict (user_id, overlay_key) do update set
    payload = excluded.payload,
    revision = oc.revision + 1,
    updated_at = now();

  select oc.revision, oc.updated_at into v_revision, v_updated_at
  from public.overlay_channels oc
  where oc.user_id = v_user and oc.overlay_key = p_overlay_key;

  revision := v_revision;
  updated_at := v_updated_at;
  return next;
end;
$$;

-- p_replace=false makes "create" atomic: a concurrent create cannot silently
-- invalidate the first token. Rotation passes true and invalidates the old hash
-- in the same statement. The plaintext token is never sent to Postgres.
create or replace function public.set_overlay_token(p_overlay_key text, p_token_hash text, p_replace boolean default false)
returns table(changed boolean, token_created_at timestamptz, token_rotated_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_changed boolean := false;
  v_created timestamptz;
  v_rotated timestamptz;
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_overlay_key is null or p_overlay_key not in ('lower-third', 'church') then
    raise exception 'invalid overlay key' using errcode = '22023';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid overlay token hash' using errcode = '22023';
  end if;

  insert into public.overlay_channels as oc (
    user_id, overlay_key, payload, revision, token_hash, token_created_at,
    token_rotated_at, token_revoked_at, updated_at
  )
  values (v_user, p_overlay_key, '{}'::jsonb, 0, p_token_hash, now(), null, null, now())
  on conflict (user_id, overlay_key) do update set
    token_hash = excluded.token_hash,
    token_created_at = coalesce(oc.token_created_at, now()),
    token_rotated_at = case when oc.token_hash is null then null else now() end,
    token_revoked_at = null,
    updated_at = now()
  where p_replace or oc.token_hash is null;

  if found then
    v_changed := true;
  end if;

  select oc.token_created_at, oc.token_rotated_at into v_created, v_rotated
  from public.overlay_channels oc
  where oc.user_id = v_user and oc.overlay_key = p_overlay_key;

  changed := v_changed;
  token_created_at := v_created;
  token_rotated_at := v_rotated;
  return next;
end;
$$;

create or replace function public.revoke_overlay_token(p_overlay_key text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_overlay_key is null or p_overlay_key not in ('lower-third', 'church') then
    raise exception 'invalid overlay key' using errcode = '22023';
  end if;

  update public.overlay_channels
  set token_hash = null, token_revoked_at = now(), updated_at = now()
  where user_id = v_user and overlay_key = p_overlay_key and token_hash is not null;
  return found;
end;
$$;

-- The only anonymous database entry point. It exposes presentation data only,
-- never user ids, token hashes, comments, drafts or unrelated settings.
create or replace function public.read_overlay_token(p_token_hash text)
returns table(overlay_key text, payload jsonb, revision bigint, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then
    return;
  end if;

  return query
  select oc.overlay_key, oc.payload, oc.revision, oc.updated_at
  from public.overlay_channels oc
  where oc.token_hash = p_token_hash
    and oc.token_revoked_at is null
  limit 1;
end;
$$;

revoke all on function public.publish_overlay(text, jsonb) from public, anon;
grant execute on function public.publish_overlay(text, jsonb) to authenticated;

revoke all on function public.set_overlay_token(text, text, boolean) from public, anon;
grant execute on function public.set_overlay_token(text, text, boolean) to authenticated;

revoke all on function public.revoke_overlay_token(text) from public, anon;
grant execute on function public.revoke_overlay_token(text) to authenticated;

revoke all on function public.read_overlay_token(text) from public;
grant execute on function public.read_overlay_token(text) to anon, authenticated;

commit;
