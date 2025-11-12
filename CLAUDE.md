# CLAUDE.md

## ⚠️ CRITICAL: TypeScript Source Files

**NEVER edit compiled JavaScript files!**

- ✅ Edit TypeScript sources in `/public/js/**/*.ts`
- ❌ NEVER edit compiled files in `/public/js/**/*.js`
- ✅ Run `npm run build:frontend` after editing TypeScript
- ✅ Use `npm run watch:frontend` for auto-recompilation

## Common Commands

```bash
# Frontend (after editing .ts files)
npm run build:frontend      # Compile TypeScript
npm run watch:frontend      # Auto-compile on changes

# Backend (Firebase Functions)
cd functions && npm run serve    # Local emulator
firebase deploy --only functions # Deploy functions
firebase deploy                  # Deploy all
```

## Project Overview

ChatVibes TTS bot management web application with:

- **Frontend**: Static site in `/public/` with TypeScript sources
  - Main pages: `index.html`, `dashboard.html`, `auth-complete.html`, `auth-error.html`
  - TypeScript compiles to JavaScript (edit `.ts` only!)

- **Backend**: `/functions/index.js` - Express.js app as Cloud Function (Node.js 22)
  - JWT sessions + Twitch OAuth with token refresh
  - Routes: `/auth/*`, `/api/bot/*`, `/api/auth/*`

- **Database**: Firestore collections
  - `managedChannels` - Bot status, OAuth tokens (managed by this app)
  - `ttsChannelConfigs` - TTS settings (managed by main TTS app)
  - `musicSettings` - Music bot settings (managed by main TTS app)

## Code Style

- Use 2nd gen Cloud Functions patterns
- Handle Twitch API rate limiting in token refresh
- Use signed cookies for OAuth state security