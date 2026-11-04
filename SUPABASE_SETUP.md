# Supabase development setup (Omnicast)

The owner has created the Free development project **Omnicast-Development** at `https://pwwqiwedmazxavfkqaje.supabase.co` and a Google OAuth Web Client in Google Cloud project `omnicast-ai-authentication`. The existing ignored `.env.local` supplied the project URL/key for a local OAuth-start request, which returned a Google redirect. Secret values were not displayed. The provider handoff is verified, but browser sign-in/callback, database connectivity, migration, and RLS remain unverified. Do not point this setup at production.

## Free-only guardrails

- Keep this development project on **Free**. Do not click Upgrade, enable billing, enable paid add-ons, or attach an unrelated paid billing account.
- Supabase Free currently includes a limited Postgres/Auth service and can pause projects after a week of low activity. It has no production SLA or paid-plan backup guarantees. If the project pauses or reaches limits, the app should fail closed until the owner chooses a remedy; do not upgrade automatically.
- Use Google sign-in for Omnicast identity. Supabase's default email sender is not production email delivery and is restricted to team addresses; no email/SMTP provider is configured by this integration.
- Do not create a project, Google OAuth client, database account, or deployment as part of local tests.

## Configure the existing development project and Google sign-in provider

1. In Google Cloud project `omnicast-ai-authentication`, check the existing OAuth client is **Web application** type. Its authorized redirect URI must include `https://pwwqiwedmazxavfkqaje.supabase.co/auth/v1/callback`. Keep the rotated Google client secret private.
2. In Supabase Authentication → Providers → Google, enable Google and enter that identity client ID and rotated secret. The Google identity secret belongs here only; it is not a Vercel environment variable. If the consent screen is in Testing, add the Google accounts used for development tests as test users.
3. In Supabase Authentication → URL Configuration, use `http://localhost:8081` as the development Site URL and allow `http://localhost:8081/api/auth/callback`. Add a Vercel Preview callback only after its URL is known. Add Production redirects only after deployment approval.
4. Keep the YouTube OAuth client and its callback separate. Its authorized redirect must be the exact `YOUTUBE_REDIRECT_URI`, e.g. `http://localhost:8081/api/youtube-callback` locally. Use `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`; do not repurpose the Supabase identity client or use a YouTube token as the Omnicast identity.
5. First confirm the Supabase dashboard project URL is exactly `https://pwwqiwedmazxavfkqaje.supabase.co`. Then review `db/migrations/001_tenant_schema.sql` and apply it only to this verified development project. It creates tables, owner-only RLS policies, composite ownership constraints and atomic publish RPCs; it contains no data import or table deletion. This has not yet been executed.

### Migration review notes

The migration contains no `DROP TABLE`, `DELETE`, or `TRUNCATE`. It does drop/recreate policies with the same names and drops/recreates the named profile trigger; these are schema/security-object changes, not data migration. Tables use `CREATE TABLE IF NOT EXISTS`, so that clause does not repair an existing table with incompatible columns or policies. Before running it, confirm the SQL editor is connected to this development project, inspect whether any of these objects already exist, then verify each table has RLS enabled and only the intended owner policies after execution. This repository could not inspect the project's live schema and has not executed the SQL.

Google OAuth has two separate clients/flows: the Supabase Google provider callback authenticates an Omnicast user; the direct YouTube OAuth callback connects a selected YouTube channel to that signed-in Omnicast user.

## Vercel/local environment variables

Set these only in the local process environment or Vercel's encrypted Environment Variables UI, never in tracked source:

| Variable | Purpose |
|---|---|
| `APP_BASE_URL` | Canonical origin used for OAuth and origin validation (`http://localhost:8081` locally). |
| `SUPABASE_URL` | Development project's Supabase URL. |
| `SUPABASE_PUBLISHABLE_KEY` | The dashboard publishable key; the server sends it in the `apikey` header. The legacy `SUPABASE_ANON_KEY` name is still accepted, but prefer this variable and do not set both. No Supabase secret/service-role key is needed. |
| `SESSION_SECRET` | At least 32 random characters; derives purpose-separated encrypted HttpOnly cookie keys. |
| `YOUTUBE_TOKEN_ENCRYPTION_KEY` | Independent high-entropy secret of at least 32 characters for encrypting YouTube access/refresh tokens at rest. |
| `YOUTUBE_CLIENT_ID` | Direct YouTube OAuth web-client ID. |
| `YOUTUBE_CLIENT_SECRET` | Direct YouTube OAuth web-client secret. |
| `YOUTUBE_REDIRECT_URI` | Exact direct YouTube callback registered on that OAuth client. |
| `GEMINI_API_KEY` | Existing Gemini server key; remains server-side and unchanged. |

The auth routes reject missing/short secrets and fail closed when Supabase is unavailable. The project URL is prefilled in `.env.example`; put the publishable key and generated secrets into the process environment or Vercel encrypted settings, never source control. Set Vercel variables separately for Preview and Production. Do not add `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, or the Google identity client secret to Vercel. The `.env*example` files contain placeholders, not credentials.

## Local development and test sequence

1. The auth/database adapter uses Node's built-in `fetch` and `crypto`; no Supabase npm package is required for its current REST implementation. Supabase's base JS client could be used if the adapter is later refactored, but Next.js/SSR middleware packages do not fit this static HTML + CommonJS API project. `npm` is not installed in the current workspace, and no package install was attempted.
2. Configure the values above in the local process, then run `node server.js` (the project does not automatically load `.env` files). A private `.env.local` is ignored by Git; with Node 20.6 or newer, it can be loaded with `node --env-file=.env.local server.js`. Alternatively, set `$env:SUPABASE_URL`, `$env:SUPABASE_PUBLISHABLE_KEY`, `$env:SESSION_SECRET`, and `$env:APP_BASE_URL` in the same PowerShell terminal before starting the server. For YouTube channel tests, also set the YouTube variables and token-encryption key.
3. Sign in with Google. The browser receives an encrypted `omni_session` HttpOnly/SameSite cookie; no auth tokens are exposed to page JavaScript. Connect YouTube separately. YouTube tokens are encrypted before storage in `youtube_channels` and are selected by the signed-in user and channel.
4. Run `node --test test/tenant-isolation.test.js`. The route tests use an in-process mock Supabase Auth/PostgREST service and two fixture identities; they do not execute PostgreSQL/RLS SQL or call Google, Supabase, YouTube, or Gemini.
5. The local OAuth-start endpoint has been checked against the development project; it returned a redirect to Google. Complete browser sign-in and verify the app callback/session, then use two test Google identities and two test YouTube channels to verify RLS, comments sync, draft create/edit, publishing authorization, and persistence after a new function instance. Those complete live tests have not yet been performed.

## Deployment boundary

The supported new account/database routes are Vercel/server.js routes. The legacy Netlify auth function returns HTTP 410 and does not provide login. Do not deploy this architecture to Netlify until a Netlify adapter has been implemented and reviewed. For Vercel, use Framework Preset **Other**, root directory `.` (repository root), blank Build Command and Output Directory `.`; this static configuration has not yet been validated with a Vercel Preview deployment. Do not deploy to Production until the real development integration tests pass and the owner separately approves it.

## Migration plan (not executed)

The existing `.data/youtube_comments.json` format has no Omnicast `user_id`; it only has YouTube channel IDs. The workspace has no `.data` directory, and a Vercel serverless filesystem cannot be treated as a reliable source of production data. Therefore no automatic ownership assignment is safe.

Before any migration:

1. Obtain explicit approval and read-only access to the actual production source. Export an immutable backup; record row counts and cryptographic checksums.
2. Inventory channels and records. Verify each channel's owner using trusted OAuth/deployment records. Do not assign a channel to whoever signs in first. Quarantine any unmapped or ambiguous row for owner review.
3. Resolve duplicate comments by `(channel_id, comment_id)` and draft/published records by `(channel_id, comment_id)`. Preserve conflicting text/history in a migration report; do not overwrite silently.
4. Import only into a separate development project, record source-to-target counts/checksums, and test RLS with two identities. Confirm encrypted credentials can be decrypted only server-side.
5. Present the final mapping, unresolved rows, counts/checksums, backup retention, and cutover/rollback steps for explicit approval before production migration.

Rollback after a future approved cutover would pause writes, preserve the migrated database unchanged, restore the pre-migration backup to the prior service only if it is still authoritative, and redeploy the prior Vercel revision. Never fall back automatically to the unscoped JSON store.
