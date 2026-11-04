# SpiritFlow Creator Studio: YouTube Comment Manager

The Creator Studio now includes a real **YouTube Comment Manager** that pulls actual SpiritFlow Sounds comments through the YouTube Data API v3, drafts replies with the free-tier Google Gemini API, and publishes replies only after explicit human approval.

## What It Does

- **Manual sync first:** use **Sync Now** in the YouTube Comments section (or `Refresh Comments`). Nothing is fetched in the background and nothing is published automatically.
- **Real comments:** comments are retrieved via `youtube.googleapis.com/youtube/v3/commentThreads` for the connected channel's uploads (with pagination and per-video limits).
- **AI reply drafts:** Gemini (`gemini-2.0-flash` or `gemini-1.5-flash`) classifies each comment (category, language, safety flag) and drafts a reply.
- **Human approval workflow:** draft → edit/save/regenerate → **Approve & Reply** (explicit owner action) → YouTube `comments.insert`.
- **Safety:** flagged comments are skipped and routed to human review. Publishing is blocked for non-SpiritFlow channels, duplicates, and missing drafts.
- **Multilingual replies:** English, Yoruba, Nigerian Pidgin, and other languages are supported via automatic language detection with owner-controlled preferences.
- **Zero additional monthly cost:** only Google Gemini free tier and the YouTube Data API v3 free quota are used.

## API Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/youtube-comments?action=list` | List comments (optional `?videoId=`). |
| POST | `/api/youtube-comments?action=sync` | Manual sync of comments from channel uploads. |
| POST | `/api/youtube-comments?action=draft-save` | Save/edit a reply draft. |
| POST | `/api/youtube-comments?action=publish` | Publish an approved reply via YouTube Data API v3. |
| POST | `/api/youtube-comments?action=flag` | Flag/unflag a comment for human review. |
| POST | `/api/youtube-comments?action=skip` | Mark a comment as skipped. |
| GET | `/api/youtube-comments?action=preferences` | Get AI reply preferences. |
| POST | `/api/youtube-comments?action=preferences` | Save AI reply preferences. |
| GET | `/api/gemini-comments?action=status` | Gemini health/quota status. |
| POST | `/api/gemini-comments?action=generate` | Classify + draft a reply for a stored comment. |
| POST | `/api/youtube-disconnect` | Disconnect the YouTube channel. |

## Safety Rules Enforced Server-Side

- Never publish AI responses automatically.
- Publishing requires an approved draft and an explicit owner action.
- Replies are only inserted for the connected channel that matches the SpiritFlow Sounds channel ID (`YOUTUBE_SPIRITFLOW_CHANNEL_ID`).
- Duplicate replies (`DUPLICATE_REPLY`) and missing drafts (`DRAFT_REQUIRED`) are rejected with clear error codes.
- Gemini paid models are blocked (`GEMINI_PAID_MODEL_BLOCKED`).
- Gemini free-tier quota exhaustion stops generation (`GEMINI_QUOTA_EXHAUSTED`) and reports the quota-exhausted state to the owner.
- Sensitive comments are flagged and never auto-published.

## Gemini Free Tier Controls

- Allowed models: `gemini-2.0-flash`, `gemini-1.5-flash` (default: `gemini-2.0-flash`).
- Classification uses a small JSON classification prompt; replies use warm Christian tone instructions.
- Reply length is capped via `maxOutputTokens` based on owner preference (`short-medium`, `medium`, `long`).
- A minimum interval between AI calls can be tuned with `GEMINI_MIN_INTERVAL_MS` (default `1500`).

## Environment Variables

```env
YOUTUBE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=your-google-oauth-client-secret
SESSION_SECRET=use-a-long-random-secret
YOUTUBE_REDIRECT_URI=https://your-vercel-domain.vercel.app/api/youtube-callback

GEMINI_API_KEY=your-google-gemini-free-api-key
GEMINI_MODEL=gemini-2.0-flash
YOUTUBE_SPIRITFLOW_CHANNEL_ID=UCyour-spiritflow-channel-id
YOUTUBE_COMMENT_PAGE_SIZE=100
YOUTUBE_COMMENT_MAX_PAGES=10
YOUTUBE_COMMENT_MAX_COMMENTS=500
GEMINI_MIN_INTERVAL_MS=1500
```

See `.env.example`, `.env.vercel.example`, and `backend/.env.example`.

## Deployment Notes

- OAuth scope now includes `https://www.googleapis.com/auth/youtube.force-ssl` for comment read/write access.
- Deploy to Vercel or Netlify; serverless function configs live in `vercel.json`.
- No additional monthly infrastructure cost is introduced; the only paid services are the existing Google OAuth/Gemini/Youtube quotas.

## Testing

- `node tests/creatorflow.test.js` — CreatorFlow API behavior.
- `node tests/youtubeComments.test.js` — YouTube comment manager, Gemini, publishing, and safety flows (mocked Google APIs).
- `npm test` — smoke checks.
- `npm run check` — page checks.

## Outstanding Requirements

- Real Google OAuth client credentials and authorized redirect URIs.
- Real Google Gemini API key with free-tier quota.
- SpiritFlow Sounds channel ID configured.
- Owner approval workflow and audit trail enabled in the studio UI.
