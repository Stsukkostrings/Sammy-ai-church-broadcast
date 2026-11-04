const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'db/migrations/001_tenant_schema.sql'), 'utf8');
const tables = ['profiles', 'youtube_channels', 'comments', 'comment_drafts', 'published_replies', 'user_settings'];

test('migration defines the six expected app tables and enables RLS on each', () => {
    for (const table of tables) {
        assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`, 'i'), `${table} table`);
        assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'), `${table} RLS`);
    }
});

test('tenant-owned child records have composite user/channel or comment foreign keys', () => {
    assert.match(sql, /comments_owned_channel[\s\S]*references public\.youtube_channels\s*\(user_id, channel_id\)\s*on delete cascade/i);
    assert.match(sql, /drafts_owned_comment[\s\S]*references public\.comments\s*\(user_id, channel_id, comment_id\)\s*on delete cascade/i);
    assert.match(sql, /published_owned_comment[\s\S]*references public\.comments\s*\(user_id, channel_id, comment_id\)\s*on delete cascade/i);
});

test('RLS policies bind reads and writes to auth.uid and authenticated role', () => {
    const policies = [...sql.matchAll(/create policy (\w+) on public\.(\w+) for all to authenticated\s+using \(auth\.uid\(\) is not null and auth\.uid\(\) = user_id\)\s+with check \(auth\.uid\(\) is not null and auth\.uid\(\) = user_id\)/gi)];
    assert.equal(policies.length, tables.length);
    assert.match(sql, /grant select, insert, update, delete on public\.profiles,[\s\S]*to authenticated/i);
    assert.match(sql, /grant usage on schema public to authenticated/i);
    assert.doesNotMatch(sql, /grant [^;]*\bto anon\b/i);
});

test('publish RPCs use invoker permissions, fixed search path, and auth-only execute grants', () => {
    for (const signature of [
        'claim_comment_publish(p_channel_id text, p_comment_id text)',
        'release_comment_publish(p_channel_id text, p_comment_id text)',
        'complete_comment_publish(p_channel_id text, p_comment_id text, p_reply_id text, p_text text)'
    ]) {
        const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.match(sql, new RegExp(`create or replace function public\\.${escaped}[\\s\\S]*?security invoker set search_path = ''`, 'i'));
    }
    assert.match(sql, /revoke all on function public\.claim_comment_publish[\s\S]*from public, anon/i);
    assert.match(sql, /grant execute on function public\.claim_comment_publish[\s\S]*to authenticated/i);
    assert.match(sql, /where c\.user_id = auth\.uid\(\)[\s\S]*p\.user_id = auth\.uid\(\)/i);
});

test('existing Auth users receive idempotent profiles and profile trigger remains least-privilege', () => {
    assert.match(sql, /security definer set search_path = ''/i);
    assert.match(sql, /revoke all on function public\.omnicast_create_profile\(\) from public, anon, authenticated/i);
    assert.match(sql, /after insert or update of email, raw_user_meta_data on auth\.users/i);
    assert.match(sql, /insert into public\.profiles[\s\S]*select id, email,[\s\S]*from auth\.users[\s\S]*on conflict \(user_id\) do update/i);
    assert.match(sql, /on delete cascade/i);
    assert.doesNotMatch(sql, /\bdelete\s+from\s+public\./i);
});

const overlaySql = fs.readFileSync(path.join(__dirname, '..', 'db/migrations/002_overlay_relay.sql'), 'utf8');

test('overlay migration stores only hashes, enables owner-only RLS, and never grants the table to anon', () => {
    assert.match(overlaySql, /create table if not exists public\.overlay_channels/i);
    assert.match(overlaySql, /token_hash text[\s\S]*token_hash ~ '\^\[a-f0-9\]\{64\}\$'/i);
    assert.match(overlaySql, /create unique index if not exists overlay_channels_token_hash_idx[\s\S]*where token_hash is not null/i);
    assert.match(overlaySql, /alter table public\.overlay_channels enable row level security/i);
    assert.match(overlaySql, /create policy overlay_channels_owner_all on public\.overlay_channels for all to authenticated/i);
    assert.match(overlaySql, /grant select, insert, update, delete on public\.overlay_channels to authenticated/i);
    assert.match(overlaySql, /revoke all on public\.overlay_channels from public, anon/i);
    assert.doesNotMatch(overlaySql, /\bto anon\b[^;]*overlay_channels/i);
    assert.doesNotMatch(overlaySql, /service_role|service-role/i);
});

test('overlay management RPCs are invoker-only and expose rotate/revoke without plaintext tokens', () => {
    for (const name of ['publish_overlay', 'set_overlay_token', 'revoke_overlay_token']) {
        assert.match(overlaySql, new RegExp(`create or replace function public\\.${name}[\\s\\S]*?security invoker set search_path = ''`, 'i'), name);
        assert.match(overlaySql, new RegExp(`revoke all on function public\\.${name}[\\s\\S]*?from public, anon`, 'i'), name);
        assert.match(overlaySql, new RegExp(`grant execute on function public\\.${name}[\\s\\S]*?to authenticated`, 'i'), name);
    }
    assert.match(overlaySql, /p_replace boolean default false/i);
    assert.match(overlaySql, /where p_replace or oc\.token_hash is null/i);
    assert.match(overlaySql, /token_hash = null, token_revoked_at = now\(\)/i);
    assert.doesNotMatch(overlaySql, /\btoken\s+text\b/i);
});

test('public overlay RPC is read-only, fixed-search-path, whitelisted, and executable by anon', () => {
    assert.match(overlaySql, /create or replace function public\.read_overlay_token\(p_token_hash text\)/i);
    assert.match(overlaySql, /security definer set search_path = ''/i);
    assert.match(overlaySql, /returns table\(overlay_key text, payload jsonb, revision bigint, updated_at timestamptz\)/i);
    assert.match(overlaySql, /where oc\.token_hash = p_token_hash[\s\S]*oc\.token_revoked_at is null/i);
    assert.match(overlaySql, /revoke all on function public\.read_overlay_token\(text\) from public/i);
    assert.match(overlaySql, /grant execute on function public\.read_overlay_token\(text\) to anon, authenticated/i);
    const start = overlaySql.indexOf('create or replace function public.read_overlay_token');
    const end = overlaySql.indexOf('revoke all on function public.read_overlay_token', start);
    assert.ok(start > -1 && end > start);
    assert.doesNotMatch(overlaySql.slice(start, end), /\b(insert|update|delete)\b/i);
});
