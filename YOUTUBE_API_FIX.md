# Fix: YouTube API Returning Demo Data

## Problem
Your YouTube API endpoint `/api/youtube-channel` returns demo/mock data instead of real YouTube channel analytics.

## Root Cause Analysis
The issue occurs when:
1. **Invalid/Expired OAuth Token** - The YouTube access token is invalid or expired, causing API calls to fail
2. **Missing Environment Variables** - YouTube OAuth credentials not properly configured
3. **Poor Error Handling** - Errors from failed API calls were not being properly caught and returned

## Solution Applied
Added robust error handling to `api/_youtubeCore.js` in the `channelHandler()` function:
- Wrapped `googleGet()` calls in try-catch blocks
- Return meaningful 401 errors when tokens are invalid
- Gracefully handle partial failures (e.g., if videos fail to load, analytics still works)

## Verification Steps

### Step 1: Check Environment Variables
Ensure these are set in your `.env` file or hosting platform settings:

```env
YOUTUBE_CLIENT_ID=your_client_id.apps.googleusercontent.com
YOUTUBE_CLIENT_SECRET=your_client_secret
YOUTUBE_REDIRECT_URI=http://localhost:8081/api/youtube-callback
SESSION_SECRET=your_session_secret_key
```

#### Where to get these:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select your project
3. Enable YouTube Data API v3
4. Create OAuth 2.0 credentials (Desktop/Web Application)
5. Set authorized redirect URIs:
   - Development: `http://localhost:8081/api/youtube-callback`
   - Production: `https://yourdomain.com/api/youtube-callback`

### Step 2: Test YouTube Connection
1. Open the app at `http://localhost:8081/spiritflow_creator_studio.html`
2. Click "Connect YouTube Channel"
3. Grant all requested permissions
4. After redirect, check browser console (F12) for any errors

### Step 3: Verify API Response
Open browser Developer Tools (F12) and check Network tab:
- Request: `/api/youtube-channel`
- **Good Response (200):**
```json
{
  "ok": true,
  "channel": {
    "id": "UCxxxxx...",
    "title": "Your Channel Name",
    "statistics": { ... }
  }
}
```

- **Bad Response (401):**
```json
{
  "ok": false,
  "error": "Failed to fetch channel data: Invalid YouTube token..."
}
```

If you get 401, **reconnect** your YouTube channel.

### Step 4: Check Console Logs
If running locally with `node server.js`:
- Look for error messages like: `Failed to fetch videos: ...`
- These indicate partial failures that have been handled gracefully

## Troubleshooting

### "No YouTube channel is connected yet"
- ✅ **Expected** if you haven't authenticated
- Solution: Click "Connect YouTube Channel" button

### "Invalid YouTube session"
- Error token cookie is corrupted or SESSION_SECRET changed
- Solution: Clear cookies and reconnect

### "Failed to fetch channel data: Invalid YouTube token"
- Your OAuth token expired or was revoked
- Solution: Click "Reconnect YouTube Channel"

### "Failed to fetch channel data: Invalid Credentials"
- OAuth credentials in env vars are wrong
- Solution: Double-check YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET

### Analytics shows "unavailable"
- YouTube Analytics API requires separate permission grant
- Solution: Reconnect account and grant all permissions, OR
- Check that `yt-analytics.readonly` scope is in OAuth config

## Production Deployment

### For Netlify/Vercel:
1. Go to your deployment platform dashboard
2. Set environment variables (Settings > Environment Variables):
   ```
   YOUTUBE_CLIENT_ID
   YOUTUBE_CLIENT_SECRET
   YOUTUBE_REDIRECT_URI=https://yourdomain.netlify.app/api/youtube-callback
   SESSION_SECRET
   ```
3. Redeploy

### For self-hosted/Docker:
Set env vars before running:
```bash
export YOUTUBE_CLIENT_ID=your_id
export YOUTUBE_CLIENT_SECRET=your_secret
export YOUTUBE_REDIRECT_URI=https://yourdomain.com/api/youtube-callback
export SESSION_SECRET=your_secret

node server.js
```

## Code Changes Made
**File:** `api/_youtubeCore.js`

**Added Error Handling:**
- Channel data fetch: Returns 401 with "token may be invalid or expired" message
- Videos fetch: Fails gracefully, continues with empty videos
- Analytics fetch: Marks as unavailable instead of crashing

**Benefits:**
- Clear error messages guide users to fix their setup
- Partial data loads even if one API call fails
- No more silent failures or cryptic error messages

## Related Files
- `server.js` - Routes YouTube API requests to handlers
- `api/youtube-channel.js` - Netlify function wrapper
- `spiritflow_creator_studio.html` - Frontend that calls the API
- `backend/config/youtube.js` - Alternative OAuth setup for Express backend

## Need More Help?
1. Check browser Console (F12) for JavaScript errors
2. Check Network tab for API response details
3. Verify Google Cloud OAuth credentials are correct
4. Ensure all scopes are granted during YouTube connection
