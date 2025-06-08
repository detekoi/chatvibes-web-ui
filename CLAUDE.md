# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Firebase Functions
```bash
# Install dependencies
cd functions && npm install

# Lint functions code
cd functions && npm run lint

# Start local emulator
cd functions && npm run serve

# Deploy functions only
firebase deploy --only functions

# View function logs
firebase functions:log
```

### Firebase Hosting
```bash
# Deploy hosting and functions
firebase deploy

# Deploy hosting only
firebase deploy --only hosting
```

## Project Architecture

This is a ChatVibes TTS bot management web application with the following structure:

### Frontend (Static)
- **Location**: `/public/` directory
- **Main Pages**: 
  - `index.html` - Landing page with Twitch OAuth login
  - `dashboard.html` - Bot management interface 
  - `auth-complete.html` - OAuth callback handler
  - `auth-error.html` - OAuth error handler
- **Key JavaScript**: `dashboard.js` contains all dashboard functionality and API interactions
- **Styling**: CSS files in `/public/css/` with animated background effects

### Backend (Firebase Cloud Functions)
- **Location**: `/functions/index.js` - Single file containing all backend logic
- **Framework**: Express.js app exported as `webUi` function
- **Authentication**: JWT tokens for app sessions, Twitch OAuth for external API access
- **Database**: Firestore collection `managedChannels` stores user data and bot status

### Key Integrations
- **Twitch OAuth 2.0**: Complete flow with token refresh and validation
- **ChatVibes TTS Service**: External service at `chatvibes-tts-service-h7kj56ct4q-uc.a.run.app`
- **Firebase**: Hosting, Cloud Functions (2nd gen), and Firestore database

### Environment Configuration
Functions require these environment variables:
- `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` - Twitch app credentials
- `CALLBACK_URL` - OAuth redirect URI 
- `FRONTEND_URL` - Frontend application URL
- `JWT_SECRET_KEY` - For signing session tokens
- `SESSION_COOKIE_SECRET` - For cookie signing

Set via `.env.<PROJECT_ID>` files for local development or Google Cloud Console for deployed functions.

### API Endpoints
- `/auth/twitch/initiate` - Start OAuth flow
- `/auth/twitch/callback` - OAuth callback handler  
- `/api/bot/status` - Get bot status for user's channel
- `/api/bot/add` - Add bot to user's channel
- `/api/bot/remove` - Remove bot from user's channel
- `/api/auth/status` - Check authentication state
- `/api/auth/refresh` - Refresh Twitch tokens

### Database Schema
Firestore `managedChannels` collection documents (keyed by Twitch login):
- `isActive` - Whether bot is active in channel
- `twitchAccessToken` / `twitchRefreshToken` - OAuth tokens
- `twitchAccessTokenExpiresAt` - Token expiration
- `needsTwitchReAuth` - Flag for required re-authentication
- User metadata (twitchUserId, displayName, etc.)

## Development Notes

- Functions use 2nd generation Cloud Functions with Node.js 22
- Frontend uses vanilla JavaScript with localStorage for session management
- CORS configured for local emulator and production domains
- Token refresh logic handles Twitch API rate limiting and errors
- State management uses signed cookies and sessions for OAuth security