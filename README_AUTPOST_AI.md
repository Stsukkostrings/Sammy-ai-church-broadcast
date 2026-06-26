# AutoPost AI

AutoPost AI is a production-style MVP that lets users upload short videos, schedule them, and automatically publish them to YouTube Shorts with the YouTube Data API v3.

## Project structure

```text
/backend
  server.js
  package.json
  .env.example
  /config
  /controllers
  /middleware
  /models
  /routes
  /services
/frontend
  index.html
  styles.css
  script.js
/uploads
```

## Features included

- JWT register/login flow
- Protected API routes
- Admin analytics dashboard
- Video uploads with `multer`
- MongoDB persistence with `mongoose`
- YouTube OAuth 2.0 connection flow
- Scheduled posting with `node-cron`
- Refresh-token-aware YouTube upload logic
- Dashboard for pending and posted videos
- Edit and delete scheduled posts
- Optional OpenAI-generated caption support
- Optional S3-backed video storage
- Docker and Docker Compose setup

## Backend setup

1. Open a terminal in the backend folder:

   ```bash
   cd backend
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy the environment template:

   ```bash
   copy .env.example .env
   ```

4. Update your `.env` values:

   - `PORT`: backend port, for example `5000`
   - `MONGODB_URI`: your MongoDB connection string
   - `JWT_SECRET`: a long random secret for signing tokens
   - `ADMIN_EMAILS`: comma-separated emails that should have admin analytics access
   - `FRONTEND_URL`: where your frontend runs, for example `http://127.0.0.1:5500`
   - `APP_BASE_URL`: your backend base URL, for example `http://localhost:5000`
   - `STORAGE_PROVIDER`: `local` or `s3`
   - `UPLOAD_MAX_FILE_SIZE_MB`: upload size limit in megabytes
   - `YOUTUBE_CLIENT_ID`: Google OAuth client ID
   - `YOUTUBE_CLIENT_SECRET`: Google OAuth client secret
   - `YOUTUBE_REDIRECT_URI`: must match your Google OAuth redirect URI
   - `TOKEN_ENCRYPTION_SECRET`: long random string used to encrypt Google tokens
   - `OPENAI_API_KEY`: optional, used for AI captions
   - `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`: only required when `STORAGE_PROVIDER=s3`
   - `AWS_S3_PUBLIC_BASE_URL`: optional CDN or bucket public URL for viewing stored videos

5. Start MongoDB locally or provide a hosted MongoDB URI.

6. Start the backend:

   ```bash
   npm run dev
   ```

## Docker setup

1. Create `backend/.env` from `backend/.env.example`.
2. Make sure your Google OAuth redirect URI includes:

   ```text
   http://localhost:5000/api/youtube/callback
   ```

3. Start the full stack:

   ```bash
   docker compose up --build
   ```

4. Open the frontend at [http://localhost:8080](http://localhost:8080).
5. The API will be available at [http://localhost:5000/api/health](http://localhost:5000/api/health).

## Storage options

- `local`: videos are stored in the repository-level `uploads` folder.
- `s3`: videos are uploaded directly to your S3 bucket and streamed from there when YouTube posting runs.

## Frontend setup

1. Serve the `frontend` folder with any static server.
2. If your backend does not run on `http://localhost:5000`, update `API_BASE` in `frontend/script.js`.
3. Open the frontend in your browser and register a new user.

## Admin analytics

- Any account whose email appears in `ADMIN_EMAILS` becomes an admin.
- Admins see an extra analytics panel in the dashboard.
- The analytics view includes:
  - total users
  - new users in the last 7 days
  - total posts
  - connected YouTube channels
  - pending, posted, and failed post counts
  - posting success rate
  - top hashtags
  - recent failed uploads

## YouTube API setup guide

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project for AutoPost AI.
3. In `APIs & Services` > `Library`, enable `YouTube Data API v3`.
4. In `APIs & Services` > `OAuth consent screen`, configure the app name, support email, and test users.
5. In `Credentials`, click `Create Credentials` > `OAuth client ID`.
6. Choose `Web application`.
7. Add an authorized redirect URI:

   ```text
   http://localhost:5000/api/youtube/callback
   ```

8. Copy the generated client ID and client secret into your backend `.env`.
9. Start the backend and frontend.
10. Log in to AutoPost AI and click `Connect YouTube`.
11. Approve access in Google.
12. After the redirect completes, your YouTube channel should appear in the dashboard.
13. To test the API manually with an access token:

   ```bash
   curl -H "Authorization: Bearer YOUR_ACCESS_TOKEN" "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true"
   ```

## Scheduler behavior

- The cron job runs every minute.
- When a pending post's `scheduledAt` time is now or earlier, the backend uploads it to YouTube.
- After success, the post is marked as `posted`.
- If the YouTube API fails, the post becomes `failed` and stores the error message.
- Editing a failed post resets it back to `pending` so the scheduler can retry it.

## Production hardening ideas

- Replace local uploads with cloud storage like S3 or Cloud Storage.
- Add request rate limiting, CSRF protection, and audit logging.
- Use HTTPS and secure cookies if you later move from local storage JWTs to cookie auth.
- Add queue workers if you expect high upload volume.
