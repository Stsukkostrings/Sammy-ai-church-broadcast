# OmniCast AI

OmniCast AI is a static HTML, CSS and browser-JavaScript application with CommonJS Node.js API handlers. It includes SpiritFlow Creator Studio, separate Omnicast Google sign-in and YouTube channel OAuth, user-scoped Supabase storage, and a server-side Gemini service. It is not a Next.js application.

## Local development

Use Node.js 20 or newer. Copy the required local environment variables into an ignored `.env.local` file, then run:

```powershell
node --env-file=.env.local server.js
```

Open `http://localhost:8081`. The local HTTP server serves the project root and dispatches API paths to the CommonJS handlers. Never commit `.env.local`.

## Environment variables

Required for Omnicast account sessions and Supabase-backed records:

- `APP_BASE_URL` — local or deployed app origin, with no path.
- `SUPABASE_URL` — the selected Supabase project URL.
- `SUPABASE_PUBLISHABLE_KEY` — publishable/legacy anon key; never use a service-role key here.
- `SESSION_SECRET` — random secret of at least 32 characters, server-side only.

Required to connect YouTube separately:

- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REDIRECT_URI` — normally `${APP_BASE_URL}/api/youtube-callback`.
- `YOUTUBE_TOKEN_ENCRYPTION_KEY` — random secret of at least 32 characters.

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` are legacy aliases for the YouTube OAuth settings. They are not Omnicast sign-in credentials. Configure Google account sign-in as a provider in the Supabase dashboard; store its OAuth client secret there, not in browser code.

Optional AI:

- `GEMINI_API_KEY` — server-only Google AI Studio key. Generation stops on missing configuration, errors, or quota exhaustion; there is no provider/model fallback.

Optional SpiritFlow configuration:

- Public stream/channel URLs: `SPIRITFLOW_STREAM_URL`, `SPIRITFLOW_YOUTUBE_LIVE_URL`, `SPIRITFLOW_YOUTUBE_CHANNEL_URL`, `SPIRITFLOW_RUMBLE_LIVE_URL`, `SPIRITFLOW_RUMBLE_CHANNEL_URL`, and `SPIRITFLOW_SUBMIT_MUSIC_URL`.
- Server-only station proxy settings: `SPIRITFLOW_AZURACAST_API_URL`, `SPIRITFLOW_AZURACAST_STATION_ID`, and optional `SPIRITFLOW_AZURACAST_API_KEY`.

`PORT` optionally changes the local server port. Do not put any secret variable in frontend JavaScript or a committed file.

## Authentication and data

Omnicast Google sign-in uses Supabase Auth and establishes the Omnicast account identity. YouTube OAuth is a separate connection flow. Server API handlers validate the signed-in account and channel ownership. Supabase access uses the user's bearer token and database Row Level Security; browser-supplied user IDs are not authorization evidence.

The SQL under `db/migrations` is not automatically applied. Before any database change, confirm the target is the development project, take a backup/export, review the migration and RLS policies, approve the mapping/duplicate/rollback plan, and test against a disposable development dataset. Production migration is not authorized by this repository workflow.

Older `.data` or file-backed records are not automatically migrated. Preserve them until an approved export and migration plan is completed.

## OBS overlay relay

OBS can read account-scoped overlays without sharing the studio browser session. An
authenticated owner creates a read-only token on `overlay-settings.html`; only a
SHA-256 hash is stored in Postgres. OBS polls the public endpoint, which returns
presentation data only. See [OBS_OVERLAY_RELAY.md](OBS_OVERLAY_RELAY.md) for the
security model, OBS setup, API contract, and migration/verification gates.

## Tests and checks

```powershell
npm test
npm run test:tenant
npm run test:api
npm run test:migration
npm run test:overlay
npm run check
npm run test:all
```

Tenant and API hardening tests use mocked services; they do not prove live Supabase, Google, YouTube or Gemini connectivity. A real Gemini request requires a valid server-side key. Never include keys in command output, screenshots, commits or reports.

Migration validation is static SQL review only; it does not connect to Postgres. Supabase Free has no automatic daily backups. Do not apply a migration until the exact development project is verified against Production, a complete backup (including relevant Auth data) is secured and restore-tested, and execution is explicitly approved. The SQL at `db/migrations/001_tenant_schema.sql` and `db/migrations/002_overlay_relay.sql` is not automatically run by Vercel.

## Vercel deployment

The repository uses static files at the project root and CommonJS functions under `/api`. `vercel.json` now explicitly selects the **Other** framework preset, project root, no Build Command, and Output Directory `.`. No production build script is required by the source layout; this configuration still needs Vercel Preview validation. Configure environment variables in Vercel Preview settings, with secrets restricted to server-side use, and register exact OAuth callback URLs in Supabase and Google Cloud.

Deployment, production configuration changes and database migrations require owner approval. Keep the previous deployment available for rollback and verify authentication, RLS, channel isolation, comments, publishing, AI quota handling and static routes in Preview first.

### Current development readiness (2026-11-03)

Latest local verification: `npm run test:all` passed (35 automated cases: 2 tenant, 8 API, 8 static migration checks, 3 OBS relay, 3 storage-scope, and 11 focused regressions; no failures/skips), smoke checks passed, page checks passed (15 pages/23 required files), and 60 JavaScript files passed syntax checks. These results do not constitute live Supabase/Google/YouTube/Gemini tests or a Vercel build. The tenant and overlay migrations have not been applied; no complete backup/restore rehearsal or Preview deployment has been completed. The local Supabase project reference matches the designated development reference, but separation from Production has not been independently confirmed. Do not migrate or deploy until the identity, backup, live isolation tests and owner approval gates in `OMNICAST_COMPLETION_REPORT.md` are satisfied.

For Vercel Preview, configure these server environment variables using the correct Preview-only values: `APP_BASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SESSION_SECRET`, `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REDIRECT_URI`, `YOUTUBE_TOKEN_ENCRYPTION_KEY`, and `GEMINI_API_KEY`. The local ignored `.env.local` contained the first four at last inspection; secret values were not displayed. Vercel values and callbacks were not inspected. No `build` script exists; use the Other preset, blank Build Command, and `.` output only after validating those settings in a Preview build. Never commit `.env.local` or add secret keys to browser code.

## Legacy Netlify functionality

Legacy Netlify files and dependencies remain in the repository for compatibility/reference. The active deployment configuration is Vercel (`vercel.json`); no Netlify deployment is claimed or required by the current architecture.

## Windows installer

No genuine Windows installer is included. Do not link or distribute `downloads/OmniCast-AI.exe` until a reproducible desktop packaging and release process produces a verified installer.
