# Migration Review: db/migrations/001_tenant_schema.sql

Date: 2025-10-31

## Scope
Reviewed the development schema for multi-tenant Omnicast AI with YouTube comment management. No migration was executed.

## Tables Reviewed
- `public.profiles` (FK to auth.users, cascade delete)
- `public.youtube_channels` (composite PK user_id+channel_id, encrypted tokens)
- `public.comments` (composite PK, FK to youtube_channels with cascade)
- `public.comment_drafts` (FK to comments with cascade)
- `public.published_replies` (FK to comments with cascade, unique reply_id per user/channel)
- `public.user_settings` (FK to auth.users with cascade)

## Security
- RLS enabled on all tables
- Policies restrict all operations to `auth.uid() = user_id` (authenticated only)
- No anonymous policies
- Grants limited to authenticated role
- Functions use `security invoker` where appropriate; `omnicast_create_profile` uses `security definer` with `search_path = ''`
- RPC functions `claim_comment_publish`, `release_comment_publish`, `complete_comment_publish` revoke from public/anon, grant to authenticated only
- Tokens stored encrypted (application layer handles encryption)

## Data Safety Concerns
- **Cascades**: Deleting a user cascades to profiles, channels, comments, drafts, replies, settings. Deleting a channel cascades to comments/drafts/replies. This is destructive - ensure backups before applying in environments with existing data.
- **FK dependencies**: `comment_drafts` and `published_replies` reference `comments` with cascade delete. Removing a comment removes related drafts and published history.
- **RLS bypass risk**: Any code using service role key would bypass RLS. The migration notes "No service-role key is used by application requests" - verify this holds.
- **No soft deletes**: All deletes are hard deletes.

## Triggers/Functions
- `omnicast_create_profile()` creates/updates profile on auth.users insert/update. Safe with `on conflict do update`.
- RPC functions enforce ownership via `auth.uid()` checks.

## Recommendations for Safe Application
1. **Backup first**: Take full DB backup before running migration
2. **Test in staging**: Apply to staging environment first with copy of data
3. **Verify RLS**: Test with non-owner authenticated users to confirm isolation
4. **Check existing data**: If tables exist with different schema, migration uses `if not exists` but may need manual migration
5. **Monitor cascades**: Be aware of cascade effects on delete operations
6. **Service role**: Ensure no service role keys are exposed/used
7. **Rollback plan**: Have rollback scripts ready (drop policies/triggers/functions/tables in reverse order)

## Notes
- Migration is marked "Development schema only" 
- No data import/overwrite/deletion in the migration itself
- All operations are additive (CREATE IF NOT EXISTS) where possible
- Policies dropped and recreated (idempotent)

## Re-review (2026-11-01)

### Local identity evidence

- `.env.local` is present and its `SUPABASE_URL` hostname reference matches the user-designated development project reference `pwwqiwedmazxavfkqaje`. Only the reference and presence booleans were inspected; no key or secret value was displayed.
- The Dashboard's `main / PRODUCTION` branch label is not conclusive evidence that a project contains production data. Supabase's current branching documentation says that label may appear on every project when dashboard branching is used, including a newly created project whose production branch is not registered yet. The live Dashboard could not be inspected from this session, and the production project's reference was not available for comparison. **Treat project separation as not independently confirmed and do not execute the migration yet.**
- User-reported: project is named `Omnicast-Development`, Free plan, `public` has zero tables, and two test users have completed local Google sign-in. Those dashboard observations were not independently verified here.

### Migration changes and validation

- The migration now backfills `public.profiles` from existing `auth.users`, idempotently, so existing sign-in identities do not miss application profile rows when the migration is eventually approved and run.
- The profile trigger now updates `display_name` when Auth metadata changes, and its `SECURITY DEFINER` execute privilege is revoked from `PUBLIC`, `anon`, and `authenticated` after trigger creation.
- Explicit `USAGE` on `public` is granted to `authenticated` so the intended RLS-scoped API can reach the app tables.
- The six-table/RLS layout, composite channel/comment foreign keys, cascading deletes, policy ownership checks, invoker RPCs, fixed search paths, profile backfill, and least-privilege grants received static source validation. No PostgreSQL parser, live catalog inspection, or database execution was available; this is not a live migration pass.
- `CREATE TABLE IF NOT EXISTS` does not reconcile a pre-existing table with a different shape. Verify all columns and constraints before execution. Named policies are dropped/recreated, so inspect for existing same-named policies first.

### Backup and rollback facts

- Supabase Free has no automatic daily backups; manual export is recommended by Supabase. CLI logical dumps exclude managed schemas such as `auth`/`storage`; the default dump is schema-only and excludes data and custom roles. Therefore one default `db dump` is **not** a complete backup for this project, especially with existing Auth test users. Storage API objects are also outside a database dump.
- Required artifacts before migration: schema dump; data-only dump; role-only dump; separate protected export of required Auth user/identity data and customizations; inventory of storage objects/settings if any; checksums; and a successful restore rehearsal in an isolated, no-cost local Postgres environment or already-approved dev restore target. Do not commit backups or put database URLs/passwords in shell history or reports.
- Rollback must default to application rollback while leaving the additive database objects and records intact. Do not `DROP ... CASCADE` or restore over this project after writes begin. If schema reversal is needed, pause writes, export current state, compare against the pre-migration backup, and obtain approval for a reviewed recovery procedure. No rollback SQL has been run.

### Current gate

No Supabase CLI, `pg_dump`, `psql`, database password/URL, management token, or Vercel CLI is configured in this local environment. No remote schema, users, RLS catalogs, billing state, or Vercel environment variables were inspected. The migration remains unapplied. Before approval to execute, confirm the dashboard project reference and that this is a distinct development project, complete and verify the full backup set, review the six-table migration including profile backfill/cascades, then obtain explicit approval for the exact migration command.
