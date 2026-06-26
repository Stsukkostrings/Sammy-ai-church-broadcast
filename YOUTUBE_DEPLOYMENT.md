# SpiritFlow Creator Studio: Real YouTube Setup

The Creator Studio now uses real serverless endpoints for YouTube OAuth, channel statistics, recent uploads, YouTube Analytics, and channel audit scoring.

## Google Cloud

1. Create or open a Google Cloud project.
2. Enable these APIs:
   - YouTube Data API v3
   - YouTube Analytics API
3. Create an OAuth Client ID for a Web application.
4. Add the same authorized redirect URI that you set in `YOUTUBE_REDIRECT_URI`:
   - Vercel: `https://your-vercel-domain.vercel.app/api/youtube-callback`
   - Netlify: `https://your-netlify-site.netlify.app/api/youtube-callback`
   - Local: `http://localhost:8081/api/youtube-callback`

## Environment Variables

Set these in Vercel or Netlify before going live:

```env
YOUTUBE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=your-google-oauth-client-secret
SESSION_SECRET=use-a-long-random-secret
YOUTUBE_REDIRECT_URI=https://your-domain/api/youtube-callback
```

Use the exact production callback URL for your deployed domain:

```env
# Vercel
YOUTUBE_REDIRECT_URI=https://your-vercel-domain.vercel.app/api/youtube-callback

# Netlify
YOUTUBE_REDIRECT_URI=https://your-netlify-site.netlify.app/api/youtube-callback
```

`SESSION_SECRET` encrypts the YouTube token cookie. Use a long random value and do not commit real secrets.

## URLs

- Start OAuth: `/api/youtube-auth`
- OAuth callback: `/api/youtube-callback`
- Live channel analysis JSON: `/api/youtube-channel`
- Front-end page: `/spiritflow_creator_studio.html`

## Deploy

Push the repo to GitHub, then import it into Vercel or Netlify.

For Netlify, `netlify.toml` already redirects the `/api/youtube-*` routes to Netlify Functions.

For Vercel, the `api/youtube-*.js` files are used directly as serverless functions.
