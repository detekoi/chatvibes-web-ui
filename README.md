# WildcatTTS Web UI

Web interface for the WildcatTTS Twitch bot.

## Description

WildcatTTS Web UI is a web application for Twitch streamers and viewers to manage the [WildcatTTS Text-to-Speech (TTS) bot](https://github.com/detekoi/chatvibes). Streamers can sign in with a Twitch account to activate or deactivate the TTS service and view its status. The application features an animated background.

> **Note:** Access to WildcatTTS is invite-only. The web management interface shows an access denied message for unapproved channels. If you want to request access, submit [this contact form](https://parfaitfair.com/#contact).

The WildcatTTS web UI is hosted at [https://tts.wildcat.chat/](https://tts.wildcat.chat/) *(invite-only access)*.

## Features

* **Twitch Authentication:** Users can sign in securely with their Twitch account.
* **Service Management:** Activate or deactivate the WildcatTTS service on approved Twitch channels.
* **Service Status:** View the active or inactive status of the TTS service for your channel.
* **Dynamic Background:** Animated background for the user interface.
* **Firebase Integration:** Uses Firebase Cloud Functions and Firebase Hosting for backend operations.
* **OBS Setup Guidance:** Setup instructions to integrate WildcatTTS audio into streaming software.

## Technologies Used

* **Frontend:**
    * HTML
    * CSS
    * TypeScript (compiles to JavaScript)
    * Bootstrap 5.3.3
* **Backend:**
    * Node.js
    * Express.js
    * Firebase Cloud Functions
    * Firebase Hosting
* **Authentication:**
    * Twitch API (OAuth 2.0)
    * JWT (JSON Web Tokens)
* **Database:**
    * Google Cloud Firestore
* **Development Tools:**
    * npm
    * ESLint
    * TypeScript compiler

## Development

### Frontend Development

CAUTION: Edit TypeScript source files in `/public/js/**/*.ts`. Do not edit compiled JavaScript files in `/public/js/**/*.js` directly because future builds overwrite them.

- TypeScript source files are located in `/public/js/**/*.ts`.
- Compiled JavaScript files in `/public/js/**/*.js` generate automatically.
- To compile TypeScript files once, run:
  ```bash
  npm run build:frontend
  ```
- To compile TypeScript files automatically during development, run:
  ```bash
  npm run watch:frontend
  ```

## OAuth Scopes and Permissions

### Broadcaster OAuth Scopes

WildcatTTS requires these OAuth scopes for all bot features:

* **`user:read:email`** - Reads user email for account identification.
* **`user:read:chat`** - Reads chat messages through Twitch EventSub.
* **`user:write:chat`** - Sends chat messages and TTS responses through Twitch EventSub.
* **`channel:read:redemptions`** - Reads Channel Point redemptions.
* **`channel:manage:redemptions`** - Refunds Channel Points for rejected TTS messages.
* **`channel:read:subscriptions`** - Detects subscription events for TTS announcements.
* **`bits:read`** - Detects Bit cheer events for TTS requirements and announcements.
* **`moderator:read:followers`** - Detects follower events for TTS announcements.
* **`channel:manage:moderators`** - Adds the bot as a channel moderator automatically.

With these scopes, the WildcatTTS bot can perform these actions:
- Monitor chat through Twitch EventSub.
- Read and respond to `!tts` commands.
- Announce subscription, Bit cheer, and follower events.
- Enforce Bit minimum requirements for TTS.
- Process Channel Point redemptions.

### Viewer OAuth Scopes

Viewers who sign in to set personal TTS preferences require no special OAuth scopes beyond basic Twitch authentication. Viewer authentication uses an empty scope list to minimize permissions.

## Setup

1. **Prerequisites:**
   * Install Node.js and npm.
   * Install and configure the Firebase CLI.
2. **Firebase Project:**
   * Create a Firebase project.
   * Enable Cloud Firestore and Authentication.
   * Configure Firebase Hosting and Cloud Functions.
3. **Environment Variables:**
   * **For Local Development (Firebase Emulator):** Create a `.env.<YOUR_PROJECT_ID>` file (for example, `.env.chatvibestts`) in the `functions/` directory. Add local variables to this file.
   * **For Deployed Functions:** Set runtime environment variables directly in Google Cloud Console under "Runtime environment variables".
4. **Install Dependencies:**
   * Open the `functions/` directory in your terminal.
   * Run `npm install` to install backend dependencies.
5. **Deploy:**
   * Run `firebase deploy` to deploy Firebase Hosting and Cloud Functions.

## Usage

**Note:** Access is restricted to approved channels. If your channel is not approved, the application displays an access denied message. [Request access through this contact form](https://parfaitfair.com/#contact).

1. Open the hosted application URL.
2. Select **Manage my channel** or **Set my own voice** to sign in with Twitch.
3. After authentication completes, the dashboard or preferences page loads.
4. On approved channel dashboards, you can perform these actions:
    * View the active or inactive status of the TTS service for your channel.
    * Activate the TTS service for your channel.
    * Deactivate the TTS service for your channel.
    * Read instructions for OBS audio setup.
    * Sign out of the application.