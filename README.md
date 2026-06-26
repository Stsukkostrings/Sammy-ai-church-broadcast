# AutoPost AI for Netlify

This folder is a standalone Netlify-ready version of AutoPost AI.

Path: [autopost-ai-netlify](C:\xampp\htdocs\ai-church-broadcast\autopost-ai-netlify)

## Important Netlify reality

This app cannot go live on Netlify with local uploads and a continuously running `node-cron` server.

Why:

- Netlify runs the backend as serverless functions, not a permanent Express server.
- Netlify function file storage is not reliable for scheduled publishing later.
- For a live YouTube autopost workflow, you should use:
  - MongoDB Atlas for the database
  - S3-compatible storage for uploaded videos
  - Netlify Scheduled Functions instead of `node-cron`

This project folder has already been adjusted for that model.

## What changed in this Netlify version

- Frontend uses relative `/api/*` calls for Netlify redirects.
- Backend is exposed through a Netlify Function in [netlify/functions/api.cjs](C:\xampp\htdocs\ai-church-broadcast\autopost-ai-netlify\netlify\functions\api.cjs).
- Scheduled posting runs through [netlify/functions/process-due-posts.cjs](C:\xampp\htdocs\ai-church-broadcast\autopost-ai-netlify\netlify\functions\process-due-posts.cjs).
- Netlify routing is configured in [netlify.toml](C:\xampp\htdocs\ai-church-broadcast\autopost-ai-netlify\netlify.toml).
- Admins can manually trigger scheduled publishing from the dashboard for testing.

## Project structure

```text
/autopost-ai-netlify
  /backend
  /frontend
  /netlify/functions
  /uploads
  netlify.toml
  package.json
  README.md
```

## Before you deploy

You need these external services:

1. MongoDB Atlas
2. Amazon S3 or any S3-compatible bucket
3. Google Cloud project with YouTube Data API v3 enabled
4. A Netlify site

## Environment variables for Netlify

Add these in Netlify Site configuration > Environment variables:

- `MONGODB_URI`
- `JWT_SECRET`
- `ADMIN_EMAILS`
- `FRONTEND_URL`
- `APP_BASE_URL`
- `STORAGE_PROVIDER`
- `UPLOAD_MAX_FILE_SIZE_MB`
- `YOUTUBE_CLIENT_ID`
- `YOUTUBE_CLIENT_SECRET`
- `YOUTUBE_REDIRECT_URI`
- `TOKEN_ENCRYPTION_SECRET`
- `OPENAI_API_KEY` (optional)
- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_S3_BUCKET`
- `AWS_S3_PUBLIC_BASE_URL`

Use the values from [backend/.env.example](C:\xampp\htdocs\ai-church-broadcast\autopost-ai-netlify\backend\.env.example) as your template.

## Google OAuth setup for Netlify

In Google Cloud Console:

1. Create or open your project.
2. Enable `YouTube Data API v3`.
3. Open `OAuth consent screen` and configure the app.
4. Create `OAuth client ID` for a web application.
5. Add this redirect URI:

```text
https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions/api/youtube/callback
```

6. Copy the client ID and secret into Netlify environment variables.

## How to deploy to Netlify

### Option 1: Deploy with Git

1. Push [autopost-ai-netlify](C:\xampp\htdocs\ai-church-broadcast\autopost-ai-netlify) to its own GitHub repository.
2. In Netlify, click `Add new site`.
3. Import that repository.
4. Set:
   - Base directory: leave blank if this folder is repo root
   - Build command: `npm install`
   - Publish directory: `frontend`
5. Add all environment variables.
6. Deploy the site.

### Option 2: Deploy with Netlify CLI

From [autopost-ai-netlify](C:\xampp\htdocs\ai-church-broadcast\autopost-ai-netlify):

```bash
npm install
<<<<<<< HEAD
netlify login
netlify init
netlify deploy
netlify deploy --prod
=======
npx netlify login
npx netlify init
npx netlify deploy
npx netlify deploy --prod
>>>>>>> 383709a (Remove invalid netlify-cli dependency)
```

## How to test locally before going live

From [autopost-ai-netlify](C:\xampp\htdocs\ai-church-broadcast\autopost-ai-netlify):

1. Install dependencies:

```bash
npm install
```

2. Create a local `.env` in [autopost-ai-netlify](C:\xampp\htdocs\ai-church-broadcast\autopost-ai-netlify) or use Netlify env syncing.

3. Start Netlify local dev:

```bash
<<<<<<< HEAD
netlify dev
=======
npx netlify dev
>>>>>>> 383709a (Remove invalid netlify-cli dependency)
```

4. Open the local URL Netlify prints, usually `http://localhost:8888`.

5. Test this order:
   - register a normal user
   - register or log in with an email listed in `ADMIN_EMAILS`
   - connect YouTube
   - upload a short video under 60 seconds
   - set schedule time a few minutes ahead
   - confirm the post appears as `pending`
   - as admin, click `Run scheduler now` to test immediate publishing

## How to test live on Netlify

After production deploy:

1. Open your live site:

```text
https://YOUR-NETLIFY-SITE.netlify.app
```

2. Confirm health endpoint:

```text
https://YOUR-NETLIFY-SITE.netlify.app/api/health
```

3. Register an admin account using an email in `ADMIN_EMAILS`.
4. Log in and confirm the analytics section appears.
5. Connect YouTube and approve OAuth.
6. Upload a test Short under 60 seconds.
7. Schedule it 5 to 10 minutes ahead.
8. Confirm the video file reaches S3.
9. In the admin dashboard, click `Run scheduler now`.
10. Confirm:
   - the post changes from `pending` to `posted`
   - a `youtubeVideoId` link appears
   - the video shows on your YouTube channel

## How scheduled posting works on Netlify

- Netlify Scheduled Functions are configured in [netlify.toml](C:\xampp\htdocs\ai-church-broadcast\autopost-ai-netlify\netlify.toml).
- This project is set to check due posts every 15 minutes.
- For immediate testing, use the admin `Run scheduler now` button.

Netlify scheduled-function note from the official docs:
- scheduled functions only run on published deploys
- you can manually run them from the Netlify UI Functions page

Source:
- [Netlify Scheduled Functions Docs](https://docs.netlify.com/build/functions/scheduled-functions/)

## Recommended live-test checklist

- MongoDB Atlas connection succeeds
- S3 upload succeeds
- `/api/health` returns `ok: true`
- registration and login work
- admin analytics loads
- YouTube OAuth redirect works
- scheduled post is saved
- admin manual scheduler run works
- video uploads to YouTube successfully

## Notes

- For live Netlify deployment, keep `STORAGE_PROVIDER=s3`.
- Do not rely on local `/uploads` storage in production on Netlify.
- If you want true minute-by-minute scheduling with longer-running workers, a VPS or Render/Railway-style backend is usually simpler than serverless.
