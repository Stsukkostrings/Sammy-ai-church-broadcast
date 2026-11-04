# Omnicast AI — final authentication, storage and deployment audit

Updated 2026-11-01. This report supersedes earlier proposals in this file. The owner created Supabase Free development project `Omnicast-Development` (`https://pwwqiwedmazxavfkqaje.supabase.co`) and Google OAuth Web Client in Google Cloud project `omnicast-ai-authentication`. The existing ignored `.env.local` was used for a non-completing local OAuth-start check; secret values were not printed. No dashboard UI was accessed, no database query or migration was performed, and no production data, paid service, or deployment was involved.

## Current architecture

- **Omnicast identity:** Supabase Auth Google sign-in uses a separate OAuth Authorization Code + PKCE flow from YouTube OAuth. `/api/auth/google` starts the flow, `/api/auth/callback` exchanges the code server-side, and `/api/auth/session` verifies the session with Supabase Auth. The session is encrypted in an HttpOnly, SameSite cookie. Browser code receives only the account email and never receives Supabase access/refresh tokens. Logout clears the account and channel-selection cookies.
- **Google OAuth setup:** the Google client configured under Supabase Auth is for Omnicast sign-in only. The callback registered in Google Cloud is `https://<project-ref>.supabase.co/auth/v1/callback`; the allowed redirect in Supabase points back to `<APP_BASE_URL>/api/auth/callback`. `/api/auth/google` requests the OAuth redirect from Supabase with the publishable/anon key server-side and sets PKCE state in an encrypted short-lived cookie.
- **Runtime fit:** the site is static HTML plus CommonJS Node handlers in `/api` and `server.js`; it is not Next.js and has no App Router or middleware. The current adapter uses Node built-in `fetch`/`crypto` against Auth and PostgREST, with an encrypted HttpOnly cookie and per-user JWT. No Supabase npm dependency is necessary for this implementation. If replacing the HTTP adapter with an SDK, the base `@supabase/supabase-js` client fits this custom session management; do not add Next.js or `@supabase/ssr`. Supabase documents `@supabase/server` for Vercel handlers that receive user auth as a Bearer header. [Supabase server package guidance](https://supabase.com/docs/guides/auth/choosing-a-server-package)
- **YouTube identity remains separate:** users first sign in to Omnicast, then independently connect YouTube. The YouTube callback verifies the Omnicast session, binds OAuth state to the verified Supabase user ID, retrieves that Google account's channel via `mine=true`, encrypts tokens at rest, and saves them under `(user_id, channel_id)`. A signed/encrypted selection cookie is also bound to the Omnicast user and is checked against database ownership on every request.
- **Authorization and persistence:** `lib/auth/youtube-context.js` verifies sessions and selected-channel ownership; `lib/db/tenant-store.js` and `lib/db/supabase-rest.js` enforce scoped data access and pass only the user's verified JWT to PostgREST. Supabase RLS is enabled for profiles, channels, comments, drafts, publishing history, and settings. Composite foreign keys ensure comments/drafts/history belong to an owned channel/comment. The application does not use a service-role key. Database and OAuth failures fail closed; no `.data` fallback is used.
- **Publishing concurrency:** `db/migrations/001_tenant_schema.sql` defines RLS-restricted RPCs to claim/release/complete a publish attempt atomically, plus unique constraints. App-side requests use these before writing replies to YouTube, so a concurrent publish cannot independently claim the same comment. A response lost after YouTube accepts a reply remains an ambiguous outcome requiring manual reconciliation; automatic retry is suppressed.
- **Settings:** `/api/user-settings` loads and writes settings under the verified account identity. User IDs supplied by the browser are never used as authorization evidence.
- **Legacy Netlify auth:** `netlify/functions/auth.js` has been changed to return HTTP 410. The former email/password implementation returned unauthenticated profile objects, used weak password hashing and required a paid email API. Its legacy route remains present but disabled. The new Supabase adapter is for the Vercel/server.js API routes; Netlify is not a supported deployment target until its adapter is separately implemented and reviewed.

## Gemini integration preserved

- Creator Studio text-generation and thumbnail understanding call `/api/ai-generate`; YouTube comment classification and reply drafting call `lib/ai/ai-service.js`. Both use the shared server-side `lib/ai/gemini.js` client. YouTube publishing remains an explicit user action.
- Gemini key is read only from server-side `GEMINI_API_KEY`. Code review found no paid-provider/model fallback. Quota errors stop subsequent generation on that instance. The in-memory application request/token counters are per serverless instance and can reset or multiply across instances; Google's project quota remains the shared hard limit.
- Official documentation checked 2026-10-31 identifies `gemini-3.5-flash-lite` as the exact model ID and marks it Stable. Google's model and pricing pages list the model as Free Tier eligible. The integration uses the documented REST API, `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent`, with `x-goog-api-key`; this project does not use a Google SDK. No model change was made.
- **No $0 claim:** model eligibility does not establish the configured project's billing tier. No key/project or live request was available for verification. The owner must verify the exact project in AI Studio/Cloud Console using the steps below. Google notes Free Tier data may be used to improve its products; sensitive content should not be submitted under that tier.

Sources: [Gemini 3.5 Flash-Lite model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), [Supabase Auth Google provider](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Database schema and migration boundary

`db/migrations/001_tenant_schema.sql` is an additive, development-only schema defining `profiles`, `youtube_channels`, `comments`, `comment_drafts`, `published_replies`, and `user_settings`; owner-only RLS policies; composite channel/comment foreign keys; indexes; and restricted publishing RPCs. Applying the SQL is **not** completed or verified against a running Postgres instance. Do not apply it to production yet.

No `.data` directory or actual production storage was available in the workspace. Earlier code had a local `.data/youtube_comments.json` store; Vercel function filesystems are not a persistent shared database. No source record ownership can safely be inferred because that historical format has no Omnicast `user_id`. No data migration, import, overwrite, or deletion was performed.

### Required migration plan and approval gate

1. After separate approval, obtain read-only access to the actual production source and create an immutable export/backup. Record row counts and cryptographic checksums. Do not treat a function filesystem as authoritative without inspecting the real deployed environment.
2. Inventory channels and rows. Map each channel to its owner only from trusted OAuth/deployment records. Quarantine ambiguous/unmapped rows; never assign data to the first account that signs in.
3. Deduplicate comments by `(channel_id, comment_id)` and drafts/history by `(channel_id, comment_id)`. Preserve conflicting text/history in a report rather than silently overwriting.
4. Present the mapping, duplicates, unresolved rows, counts/checksums, backup retention and rollback plan for approval before any production write.
5. Test import into a separate development project first. Compare counts/checksums and test two accounts, two channels, RLS, and persistence across function instances.
6. For a future approved cutover, pause writes, retain the immutable original, switch to the database, validate, then resume. Rollback pauses writes and redeploys the previous Vercel revision with the preserved source backup. Never silently fall back to global JSON storage.

## Free-only Supabase setup

The owner-created Free development project exists, but its billing tier, Google provider setup, key configuration, schema, and live connectivity have not been verified by this workspace. Supabase Free has limits and may pause low-activity projects; the application must fail closed if the project pauses or reaches limits. Do not upgrade, activate add-ons, or attach billing without separate approval. No production uptime/backup guarantees are claimed.

1. Keep the existing project Free. Its URL is `https://pwwqiwedmazxavfkqaje.supabase.co`; set `SUPABASE_URL` to that value and use the dashboard publishable key as `SUPABASE_PUBLISHABLE_KEY`. Do not use a secret/service-role key.
2. The owner-created Google Web Client must include `https://pwwqiwedmazxavfkqaje.supabase.co/auth/v1/callback` as its authorized redirect URI.
3. In Supabase → Authentication → Providers → Google, enable Google and enter the identity client ID and rotated secret. Set the development Site URL and allow `http://localhost:8081/api/auth/callback`. Add only approved Preview callbacks; Production redirects remain out until deployment approval.
4. Keep the separate YouTube OAuth client and its `/api/youtube-callback` authorized redirect. Do not combine the two OAuth scopes or use the YouTube token as an Omnicast identity.
5. Review `db/migrations/001_tenant_schema.sql` and apply it only to the approved development project. Confirm RLS is enabled and policies/functions are present in the Supabase dashboard. This migration contains no import/delete statements.

### Environment variables

Set only in local untracked environment or Vercel's encrypted environment-variable UI. Use separate development values for local and Preview; add Production values only after approval.

| Variable | Required for | Notes |
|---|---|---|
| `APP_BASE_URL` | OAuth and origin validation | Local example `http://localhost:8081`; deployed canonical origin in Vercel. |
| `SUPABASE_URL` | Account auth and Postgres REST | Development project URL. |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase requests | Use the dashboard publishable key. `SUPABASE_ANON_KEY` remains a legacy alias; do not set both. Never use a service-role key. |
| `SESSION_SECRET` | Encrypted account/flow cookies | At least 32 high-entropy characters; rotate only with a planned session invalidation. |
| `YOUTUBE_TOKEN_ENCRYPTION_KEY` | Token encryption at rest | Independent high-entropy secret, at least 32 characters. Losing it requires reconnecting channels. |
| `YOUTUBE_CLIENT_ID` | Separate YouTube OAuth | Web application client ID. |
| `YOUTUBE_CLIENT_SECRET` | Separate YouTube OAuth | Server-side only. |
| `YOUTUBE_REDIRECT_URI` | YouTube callback | Exact origin plus `/api/youtube-callback`, registered on the YouTube OAuth client. |
| `GEMINI_API_KEY` | Gemini generation | Server-side only; use only after owner confirms Free Tier status. |
| `SPIRITFLOW_AZURACAST_API_URL`, `SPIRITFLOW_AZURACAST_STATION_ID`, `SPIRITFLOW_AZURACAST_API_KEY`, optional `SPIRITFLOW_*_URL` values | Optional player/config | Only set if those optional radio configuration features are used. |

The Supabase Google provider client secret belongs in Supabase Auth provider settings, not Vercel. Never add Google, Gemini, YouTube, or Supabase service-role secrets to browser code, `.env.example`, or GitHub.

## Exact Gemini Free Tier checks and live test

1. At [Google AI Studio API keys](https://aistudio.google.com/api-keys), select the exact project that owns the key. Confirm its displayed plan/billing tier is **Free** and the project is not marked Paid, Payment needed, restricted, or ineligible.
2. In Google Cloud Console → Billing → My projects (or the selected project's billing page), confirm no active Cloud Billing account is linked. Do not select **Set up billing**. If an account is linked or the project's status is unclear, stop and do not claim $0.
3. In AI Studio's quota/rate-limit view, inspect the exact `gemini-3.5-flash-lite` project's current RPM/TPM/RPD limits and usage. Free model eligibility does not guarantee quota capacity or project Free Tier status.
4. Put the key in local server environment as `GEMINI_API_KEY`; never paste it into source, browser devtools, a chat, or logs. Start the development server and sign in with an approved test account. Trigger the Creator Studio one-request connection test or a harmless prompt once.
5. Require a successful `/api/ai-generate` response with `ok: true`, nonempty text and `model: "gemini-3.5-flash-lite"`. Confirm the same request appears in the selected project’s AI Studio usage. This paired evidence verifies the live request reached the selected model. Do not infer success from the UI alone.
6. For quota handling, use a development key/project at a known exhausted quota or a controlled mocked 429 test. Require a quota error and no fallback request. Do not intentionally exhaust a production quota.

No live Gemini request, billing check, or quota check was possible here because no valid key/project was supplied. The automated mocked quota-stop test passed.

## Verification results and evidence levels

### Local automated and mocked tests — passed

Executed with the available Node runtime:

- `node --test test/tenant-isolation.test.js` — 2 tests passed. The route tests use an in-process mock Supabase Auth/PostgREST service, not fake production authentication. They verify PKCE callback exchange, separate session cookies resolving to separate identities, session validation and refresh, logout revocation/cookie clearing, tampered and missing-PKCE rejection, anonymous AI/comments rejection, user-scoped channel/settings/comment/draft/history data, cross-user draft/publish rejection before any YouTube call, account A draft generation/edit and YouTube token isolation, mock persistence after handler reload, and mocked Gemini quota stopping the follow-up upstream call.
- `node check-pages.js` — passed for 14 HTML pages and 17 required files. It reported external-link notes only; no broken required internal page references or inline script parse failures.
- `node --check` — passed for `api/auth/google.js`, `netlify/functions/auth.js`, and `test/tenant-isolation.test.js`.
- `package.json` includes `test:tenant`; `test:all` runs existing smoke checks, tenant test and page checks.

These tests are mocked. Their in-memory RLS simulation does not execute PostgreSQL policies or contact the owner's Supabase project. Handler reload demonstrates the mock store survives a module reload, not real Vercel instance restart persistence.

### Code review only

- Session verification with Supabase Auth `/user`, refresh handling, HttpOnly cookies, user JWT database calls, scoped ownership filters, RLS SQL, encrypted YouTube token storage, channel-bound OAuth state, and publish claim/complete RPC flows were inspected.
- Gemini service call graph and API key handling were inspected; no provider fallback was found.
- Vercel route/function config and no-build static layout were inspected.

### Not tested/live blockers

- The Supabase OAuth-start endpoint made a live request and returned a redirect to Google, but no Google account sign-in, OAuth callback exchange, authenticated live session, Postgres migration/RLS execution, two independent real Omnicast accounts, two real YouTube channel connections, live comment retrieval/synchronization, live draft persistence, real YouTube publishing, cross-instance database persistence, real Gemini request, actual quota response, Vercel Preview build/deploy, or production deployment was performed.
- The owner must complete Google sign-in in a browser against the local server, confirm the callback establishes a session, then apply the schema only to the verified development project and test two independent identities/channels, live RLS and persistence. Use test channels and controlled non-sensitive comments.
- Production migration/deployment remain blocked pending the separately approved migration plan, real development test results, owner review, and explicit production deployment approval.

## Local server diagnosis and fix (2026-11-01)

- **Reproduced static 404 cause:** static paths were built relative to `process.cwd()`. A controlled HTTP run with the same `server.js` and working directory set to the repository's parent returned 404 for `/`, `/index.html`, and `/style.css`; with the project root as CWD, `/index.html` returned 200. Static requests are now resolved relative to `__dirname`, so starting the server by absolute script path or from a parent directory uses the same site root.
- **Root route correction:** `/` previously resolved to `studio.html` (HTTP 200, title `Studio | OmniCast AI`) rather than the public homepage. `/` now maps to `index.html`.
- **Auth API local-server defect:** `server.js` passed Node's native `ServerResponse` to Vercel-style functions that call `.status().json()`/`.send()`. The route's rejected Promise was returned without `await`, bypassing the surrounding `try/catch`; requesting `/api/auth/session` from the old local process yielded `ECONNRESET`. A small response adapter now supports those methods and route promises are awaited, while the individual Vercel API functions remain unchanged.
- **Static safety:** query strings are excluded from file lookup, path traversal is rejected, dotfiles and private source/config paths are blocked, and unhandled `/api/*` paths return 404. HTTP checks confirmed `/.env.local` and `/server.js` return 404.
- **Local HTTP results using `.env.local`:** `/` and `/index.html` returned 200 with the SpiritFlow homepage title; `/style.css`, `/auth.js`, `/app.js`, `/spiritflow-player.js`, and `/channels4_profile.jpg` returned 200 with expected content types. `/api/auth/session` returned 401 for an anonymous request without terminating the server. `/api/auth/callback` without an authorization code returned 302 to the local app. `/api/auth/google` returned 302 to `accounts.google.com` after a live, non-completing Supabase OAuth-start request. This verifies provider handoff only; no Google account sign-in or callback completion was performed.
- `.env.local` was inspected without printing values: `APP_BASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SESSION_SECRET` are present; the URL matches the specified development project, the configured publishable-key variable is selected, the session secret meets the code's minimum length, and the app base URL matches `http://localhost:8081`.
- Port 8081 initially returned `EADDRINUSE`. An existing listener returned `/` as the Studio page and `/index.html` as the homepage; its PID could not be obtained from the restricted `netstat` view. Its session endpoint reset the connection and then the listener disappeared. The patched server was subsequently tested on 8081 successfully. Do not terminate an unidentified process if this recurs; inspect it locally before stopping it.
- Current execution tools expose Node `v24.22.1` and no `npm.cmd`, despite the user's machine report of Node 26/npm 11. Requested `npm.cmd test`, `npm.cmd run test:tenant`, and `npm.cmd run check` could not run because npm is not on this execution environment's PATH. Direct equivalents passed: `node --test test/tenant-isolation.test.js` (2 tests), `node check-pages.js` (14 pages), and `node --check server.js`.

## Vercel configuration and deployment readiness

- Repository has root-level static HTML and `/api` CommonJS functions. `vercel.json` sets clean URLs and per-function durations. No framework build output exists. There is no `build` script; for this static site use Vercel Framework Preset **Other**, repository root as root directory, blank Build Command, and Output Directory `.`. This is a configuration recommendation from repository inspection, not a verified Vercel build/deployment. The project currently has no install/build bundle step required for these routes, though Vercel Preview validation is still required.
- Local server command is `node server.js`. Node is available, but `npm`, Vercel CLI, Supabase CLI, Docker, the publishable key, rotated Google client secret, and deployment access were not available here; tests were run using the provided Node executable directly. No successful build or deployment is claimed.
- For a future development Preview, create only the approved Free Supabase project, apply and verify the migration there, set the environment variables above in Vercel Preview, set Vercel Framework Preset/Output as above, deploy Preview only after test credentials are configured, and validate all callbacks against exact registered redirects. Keep Production variables absent until the owner approves production.
- Before production: complete the actual two-account/two-channel tests, approve the migration mapping and backup, confirm Gemini Free Tier project status, add Production environment variables, register production callbacks, deploy and validate pages/API flows, and obtain explicit approval for production deployment and data cutover. Preserve the prior Vercel deployment and immutable export for rollback. No automatic deployment/cutover is authorized.

## Windows installer

No genuine Windows installer exists in the repository: no executable, MSI, Windows packaging project or release workflow was found. The homepage no longer links to `downloads/OmniCast-AI.exe`; the label states the installer is unavailable. No placeholder was created. Existing site and Creator Studio source are retained. A release requires selecting a packaging target, adding a reproducible Windows build/release workflow, testing install/launch/uninstall on a clean machine, signing/checksumming the artifact if publicly distributed, and only then publishing a working link.

## Remaining blockers / owner actions

1. Configure the existing Supabase Free development project with the Google provider and allowed redirects; keep the rotated provider secret in Supabase Dashboard only.
2. Review and apply the schema only after confirming the exact development project; verify live RLS behavior and perform the real two-user/two-channel integration test.
3. Set server values locally or in Vercel Preview UI without sharing them in chat or source control; verify AI Studio tier/billing and perform a real Gemini request if desired.
4. Decide how the legacy `.data` records will be mapped only after a read-only production export; approve the detailed migration mapping and rollback plan before any migration.
5. Approve a Preview deployment after the development tests pass. Production deployment, production data migration, Supabase upgrades/add-ons, paid services, and a desktop installer release each require a separate approval.

The architecture implementation is ready for controlled development setup; the assignment is **not fully production-complete**. Live identity/database/RLS validation, migration, and deployment remain outstanding.

## Production audit execution update (2026-11-01)

This update records checks made against the current workspace snapshot. It does not replace the previously documented integration limitations.

### Verified in this execution environment

- The working directory contains the static site, CommonJS `/api` handlers, tests, migration and `vercel.json`, but it is **not a Git checkout**: `git rev-parse --show-toplevel` and `git status` both report that no repository exists. No Git remote or intended deployment branch can therefore be verified, and there are no tracked/untracked changes that can be safely committed from this snapshot.
- There is no `.vercel/project.json` link and no Vercel CLI available. Production project identity, environment variables, deployment logs and rollback target cannot be verified here. The production URL could not be inspected using the available web reader. **No deployment was attempted.**
- Node.js is available, but `npm.cmd` is not on this execution environment's PATH, and `node_modules` is absent. The requested npm scripts could not be invoked here. Direct Node equivalents were run instead:
  - `node --test test/tenant-isolation.test.js` — passed, 2 tests. These use mocked Supabase, database, YouTube and Gemini responses; they are not live account/channel isolation tests.
  - `node check-pages.js` — passed, 14 HTML pages and 17 required files; it emitted external-host notes.
  - Existing package smoke-check command — passed.
  - `node --check` over 32 JavaScript files — passed.
- Read-only environment-name inspection found `APP_BASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SESSION_SECRET` populated in the ignored local `.env.local`; values were not displayed. The expected separate YouTube variables (`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`, `YOUTUBE_TOKEN_ENCRYPTION_KEY`) and `GEMINI_API_KEY` are absent from this local file. This is not a check of Vercel Production or Preview variables.
- Repository search found no homepage or HTML/JavaScript link to `downloads/OmniCast-AI.exe`; the file is absent. `vercel.json` contains a generic `/downloads/(.*)` response header only, not an installer. No installer was fabricated.
- There is no production build script. `vercel.json` is consistent with Vercel's static “Other” preset, blank Build Command and `.` output directory, but this configuration has not been validated by a Vercel build.

### Deployment gate

Production deployment remains blocked. The deployment source/revision and Vercel project cannot be identified from this workspace; local npm-driven checks cannot run; live two-account/two-channel isolation, actual development-project RLS and persistence, YouTube integration, and a live Gemini request have not been verified. The local Supabase migration is still unapplied. Do not infer that absent local secrets are absent in Vercel, and do not add guessed values. To resume safely, open the canonical Git checkout with the intended remote/branch, confirm the existing Vercel project linkage, restore npm to PATH, complete the approved development-only Supabase schema and two-account integration tests, then review the exact production environment-variable names and callback URLs in Vercel/Google/Supabase. Only after those checks pass should the owner-approved production deployment be attempted, with the prior Vercel deployment retained for rollback. No production data migration is authorized by this report.

### Current Gemini model documentation check (2026-11-01)

Google's current official model catalog lists `gemini-3.5-flash-lite` as Stable and gives that exact API model ID. The official pricing page currently lists Standard-tier text input/output as Free Tier eligible. The implementation's REST endpoint and model ID match this catalog; no model change was made. This confirms current model documentation and published tier eligibility only. The configured Google project's billing status, quota, key validity and actual successful API response remain unverified; this is not a $0 guarantee. Sources: [Google model catalog](https://ai.google.dev/gemini-api/docs/models), [model details](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), and [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).

### Local remediation continuation (2026-11-01)

This section supersedes earlier environment notes that npm was unavailable: in this continuation the installed `C:\Program Files\nodejs\npm.cmd` was available and the project's npm scripts ran. `npm test`, `npm run test:tenant` (2 passed), `npm run test:api` (8 passed), `npm run check` (14 HTML pages/17 required files), and `npm run test:all` passed. A syntax check covered 46 JavaScript files with no syntax failures. These checks use mocks for external integrations.

Local code changes tightened mutation-origin checks, removed wildcard CORS from active comments and legacy health/Whisper handlers, hardened user-settings parsing and HEAD handling, retained publish claims after uncertain outcomes, added store-side range pagination, removed heuristic analytics scores and random hashtag shuffling, and removed invented radio schedule entries/live claims. The new [completion report](OMNICAST_COMPLETION_REPORT.md) describes file-level scope and exact limitations.

The local server printed its startup message, but route HTTP checks could not be completed: this environment denied loopback socket access. No Supabase, Google, YouTube, Gemini or Vercel live test was performed. Production migration and deployment remain blocked pending the development-only live auth/RLS tests, migration plan/approval, and Preview verification listed in the completion report.

### Development database and deployment readiness continuation (2026-11-01)

- Secret-safe local environment inspection found the Supabase URL reference is `pwwqiwedmazxavfkqaje`, matching the user-designated Omnicast-Development project. `APP_BASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SESSION_SECRET` are present locally. YouTube OAuth variables (`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`, `YOUTUBE_TOKEN_ENCRYPTION_KEY`) and `GEMINI_API_KEY` are absent from the local file. Vercel Preview/Production environment variables were not inspected.
- A Vercel project link (`.vercel/project.json`), Vercel CLI, Supabase CLI, `pg_dump`, `psql`, Docker, DB connection string/password, Supabase access token, and Vercel token are unavailable in this environment. There is no dashboard-read capability in this run; read-only catalog inspection, full backup, restore rehearsal, and Preview deployment were not completed.
- Supabase currently documents `main / PRODUCTION` as a generic branch label that can appear on every dashboard-branched project, including a new project. Therefore that label alone does not prove the referenced project contains production data. The local reference matches the supplied development reference, but the production project's Supabase reference could not be compared. Treat distinct-project status as not independently confirmed and do not run the migration yet. [Supabase branching dashboard documentation](https://supabase.com/docs/guides/deployment/branching/dashboard)
- User-reported (not independently inspected): project name Omnicast-Development, Free plan, public schema has zero tables, and two Google test accounts signed into local Omnicast.
- Static migration review found `public.profiles` was not backfilled for pre-existing Auth users. The local migration now performs an idempotent profile backfill, updates profile display names on Auth metadata changes, revokes direct execute rights on its security-definer trigger function, and explicitly grants `USAGE` on `public`. The migration remains unapplied. Five static SQL validation tests passed; no SQL parser or live PostgreSQL catalog was available.
- Supabase Free does not provide automatic daily backups. Its CLI dump defaults to schema-only and excludes data, custom roles, and managed schemas such as Auth and Storage. The official recovery guide uses separate role/schema/data dumps; Auth data and Storage API objects require additional handling. A complete, restore-tested backup has not been made. [Free backup FAQ](https://supabase.com/kb/faqs/platform/free-plan-backups), [backup documentation](https://supabase.com/docs/guides/platform/backups), [CLI backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [Auth user export instructions](https://supabase.com/docs/guides/auth/managing-user-data)
- `vercel.json` now explicitly selects the Other framework, blank build command, root output, and retains existing function/security configuration. `.vercelignore` now excludes the local data directory, tests, root migration files and common credential/backup paths. The Vercel schema/configuration was not validated by the Vercel CLI or a Preview deployment. The underscore-prefixed `api/_*.js` modules are helper files per Vercel's documented behavior, not public function entrypoints. [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json), [Node helper files](https://vercel.com/docs/functions/configuring-functions/advanced-configuration)
- Added `npm run test:migration` with five static checks. `npm run test:all` passes: 15 automated cases (2 tenant + 8 API + 5 migration), 0 failed/skipped; smoke check and 14-page/17-resource check passed. These do not replace live Auth/RLS, restore, Gemini, YouTube, or Vercel Preview testing.

**Gate:** No database modifications, backup/export, deployment, production changes, or live integration requests were performed. Compare the development project reference to the Production Vercel project's Supabase reference, complete and restore-test a full Free-plan backup, obtain approval for the exact migration, then validate two-account RLS/auth/data flows before a Preview deployment.

### Final local verification refresh (2026-11-01)

Latest local results supersede earlier counts/runtime notes: `npm test` passed; `npm run test:tenant` passed (2); `npm run test:api` passed (8); `npm run test:migration` passed (5 static SQL-source checks); `npm run check` passed (14 HTML pages, 17 required files); and `npm run test:all` passed (15 automated cases, 0 failed/skipped, plus smoke and page checks). `node --check` covered 47 JavaScript files with zero syntax errors.

Classification: these are automated local checks. Tenant/API tests use mocks and fixtures; migration tests are static assertions, not a PostgreSQL parser or live migration. Code review covers query scoping, RLS definitions, migration behavior, credential handling and deployment configuration. No live Supabase catalog/RLS check, complete backup/restore, real two-user/two-channel test, credentialed Gemini/YouTube test, or Vercel Preview build/deployment was performed in this final verification. Earlier audit entries describe a prior live OAuth-start handoff only; that did not complete Google authentication or establish a live authenticated session.

**Readiness remains PARTIALLY READY.** The local Supabase project reference matches the designated development reference. Its separation from Production, dashboard plan/billing state, schema, Auth profiles, Vercel environment, and deployment linkage remain unverified. The migration is unapplied. No backup or restore rehearsal exists from this work. Required gates are: compare the development reference with Production's Vercel Supabase reference; confirm dashboard identity; create and restore-test a complete protected no-cost backup (including required Auth/Storage material); review and approve the exact development migration; run live two-account/channel RLS and persistence tests; configure and validate Preview variables/callbacks; then obtain separate deployment approval. Do not upgrade or use any paid service to bypass a Free-tier limitation.

For Preview, required variables are `APP_BASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SESSION_SECRET`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`, `YOUTUBE_TOKEN_ENCRYPTION_KEY`, and `GEMINI_API_KEY`. Only the first four were present locally at the last secret-safe inspection; Vercel Preview/Production settings were not accessed. `vercel.json` selects Other, no build command, and `.` output for the static-root/CommonJS architecture, but Vercel has not validated it. No database migration, export, deployment, billing change or production operation occurred.
