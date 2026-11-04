# Secure OBS Overlay Relay

OmniCast AI can serve scripture and lyric overlays to OBS without depending on the
studio browser being open or logged in. The studio publishes to the signed-in
account's overlay channel; OBS polls a read-only URL that contains a revocable
token for that channel.

## Why this exists

The original `lower-third.html` and `church_studio.html?overlay=lower-third`
pages received data through browser `localStorage`/`BroadcastChannel`. That is
fine for a same-browser preview, but OBS runs as a separate browser process and
does not share the studio's storage or session. The relay closes that gap while
keeping overlay data account-scoped.

## Security model

- One overlay row per account and channel: `lower-third` or `church`.
- The Node runtime generates a 32-byte random token. Only a SHA-256 hash is sent
  to Postgres. Plaintext tokens are returned exactly once, when generated or
  rotated.
- A token is read-only. The only anonymous database entry point is
  `read_overlay_token`, which returns presentation fields only.
- The public API uses the Supabase publishable/anon key only. It never uses a
  service-role key and never sends a user bearer token.
- Owner reads and writes use the signed-in user's access token plus Row Level
  Security. The API also scopes table queries by `user_id`.
- Rotating or revoking replaces/removes the token hash immediately. The old OBS
  URL fails on its next poll.
- Public responses are rebuilt from an allowlist: `reference`, `text`,
  `visible`, `isLoading`, and `hidden`. Comments, drafts, user ids, token hashes,
  account details and unrelated settings cannot pass through.
- Public polling has per-address and per-token limits. Management and publish
  routes use the authenticated distributed rate limiter, with the local
  in-memory fallback.
- Management and publish routes require an authenticated account and a
  same-origin `Origin` for mutations. The public route rejects cross-origin
  browser origins and only allows `GET`/`HEAD`/`OPTIONS`.

## OBS setup

1. Sign in to OmniCast AI with the account that owns the overlay.
2. Open `overlay-settings.html` (linked from Main Studio, Church Studio, Lyrics
   and the Omnicast AI tool hub).
3. Choose **Scripture lower third** or **Church scripture overlay**.
4. Click **Generate secure link** and copy the URL immediately. OmniCast does not
   store the plaintext token and cannot show it again.
5. In OBS, add a **Browser** source and paste the URL.
6. Set the source size to `1920 x 1080` (or match your OBS canvas).
7. Keep the background transparent. The overlay page is designed to render with
   transparency; do not add an opaque custom CSS background.
8. Leave **Shutdown source when not visible** off if you want the source to keep
   polling between scenes.

The overlay page polls about once per second. OBS does not need the studio
browser, its login session, or browser storage.

To rotate, return to **Secure OBS Links** and click **Rotate token**. To stop an
old URL permanently, click **Revoke token**. Both actions affect the next poll;
OBS may display the last overlay for up to roughly one second before receiving
the invalid-link message.

## Endpoints

| Route | Method | Access | Purpose |
| --- | --- | --- | --- |
| `/api/overlay-channel` | `GET` | Signed-in owner | Safe channel metadata; never returns a token or hash |
| `/api/overlay-channel` | `POST` | Signed-in owner, same origin | `create`, `rotate`, `revoke` |
| `/api/overlay-publish` | `POST` | Signed-in owner, same origin | Publish allowlisted presentation data |
| `/api/overlay-public` | `GET`/`HEAD` | Public token | Read presentation data for OBS |

Successful public response shape:

```json
{
  "ok": true,
  "overlay": {
    "key": "lower-third",
    "payload": {
      "reference": "John 3:16",
      "text": "For God so loved the world",
      "visible": true
    },
    "revision": 4,
    "updatedAt": "2026-11-03T10:00:00.000Z"
  }
}
```

Invalid, rotated and revoked URLs return `404` with a generic message. The
public response never includes a user id, token hash, comments, drafts or
settings.

## Migration

The relay requires `db/migrations/002_overlay_relay.sql`. Like
`001_tenant_schema.sql`, it is not run automatically by Vercel.

Before applying it:

1. Confirm the exact Supabase project reference and compare it with Production.
2. Take a complete backup, including relevant Auth data, and verify it can be
   restored.
3. Rehearse `001` and `002` on a disposable dataset.
4. Apply `002` in the Supabase SQL editor only after the backup and target checks
   pass.
5. Verify `overlay_channels` has RLS, the owner policy, no `anon` table grant,
   the token-hash unique index, and the four functions/grants.
6. Sign in with two real accounts. Create a token on account A, confirm account B
   cannot read it through the owner API, rotate it, confirm the old token stops,
   revoke it, and confirm the new token stops.
7. Confirm the public endpoint uses only the publishable key and returns no
   private fields.

Do not apply this migration without a verified backup, a confirmed target, a
rehearsal, and live two-account RLS tests. The migration is idempotent for the
objects it creates, but it is still a schema change.

## Local verification

```powershell
npm run test:overlay
npm run test:migration
npm run test:all
npm run check
```

The overlay test uses a mocked Supabase REST endpoint. It proves the relay
contract, token hashing/lifecycle, public allowlist, read-only route, and
same-account scoping. It does not prove live Supabase RLS, live OAuth, Vercel
routing, or OBS rendering. Those remain deployment checks.

## Troubleshooting

- **OBS shows “Overlay link is invalid or has been revoked.”** Generate a new
  link on the settings page. Plaintext tokens cannot be recovered.
- **Studio publish does nothing.** The studio must be signed in and the API must
  be configured with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and
  `SESSION_SECRET`. An unauthenticated publish is rejected without affecting the
  local preview.
- **Public endpoint returns `503`.** Persistent storage is not configured or the
  database is unavailable. The migration may not be applied yet.
- **OBS link works but stays empty.** Check that the studio is publishing to the
  same channel (`lower-third` vs `church`) that the token belongs to.
- **Need a same-browser preview.** `lower-third.html` without a token and
  `church_studio.html?overlay=lower-third` without a token still use the original
  local storage/channel behavior.
