# ChatVibes Bot Management

## Description

ChatVibes Bot Management is a web application that allows approved Twitch streamers to manage the [ChatVibes **Text-to-Speech (TTS)** bot](https://github.com/detekoi/chatvibes) for their channel. Users can log in with their Twitch account to add or remove the bot, and view its current status. The application features a dynamic, animated background.

> **Important:** Access to ChatVibes is currently invite-only. The management interface will show an access denied message for unapproved channels. If you'd like to request access, please contact me via [this contact form](https://detekoi.github.io/#contact-me).

Currently, the ChatVibes web UI is hosted [here](https://tts.wildcat.chat/) *(invite-only access)*.

## Features

* **Twitch Authentication:** Users can log in securely using their Twitch account.
* **Bot Management:** Add or remove the ChatVibes bot from your Twitch channel through a simple interface (for approved channels only).
* **Bot Status:** View the current status (active/inactive) of the bot for your channel.
* **Dynamic Background:** An animated static-like background enhances the user interface.
* **Firebase Integration:** Utilizes Firebase for backend functions and hosting.
* **OBS Setup Guidance:** Instructions on how to integrate ChatVibes TTS audio into their streaming software.

## Technologies Used

* **Frontend:**
    * HTML
    * CSS
    * JavaScript
* **Backend:**
    * Node.js
    * Express.js
    * Firebase Cloud Functions
    * Firebase Hosting
* **Authentication:**
    * Twitch API (OAuth)
    * JWT (JSON Web Tokens)
* **Database:**
    * Firestore (Google Cloud Firestore)
* **Development Tools:**
    * npm
    * ESLint

## OAuth Scopes & Permissions

### Broadcaster/Streamer OAuth Scopes

When streamers authenticate with Twitch, the following OAuth scopes are requested to enable full bot functionality:

* **`user:read:email`** - Access user email and basic profile information
* **`chat:read`** - Read chat messages in the broadcaster's channel
* **`chat:edit`** - Send chat messages and TTS responses in the broadcaster's channel
* **`channel:read:subscriptions`** - Detect subscription events for TTS announcements
* **`bits:read`** - Detect bits/cheer events for TTS requirements and announcements
* **`moderator:read:followers`** - Detect follow events for TTS announcements (optional)
* **`channel:manage:redemptions`** - Manage channel point redemptions
* **`channel:read:redemptions`** - Read channel point redemptions

These scopes enable the ChatVibes bot to:
- Connect to and monitor the broadcaster's chat
- Read and respond to TTS commands
- Announce subscription, bits, and follower events
- Support bits-gated TTS modes
- Integrate with channel point redemptions

### Viewer OAuth Scopes

Viewers who authenticate to set personal TTS preferences do not require any special OAuth scopes beyond basic Twitch authentication. Viewer authentication uses an empty scope list to minimize permissions.

## Setup

1.  **Prerequisites:**
    * Node.js and npm installed.
    * Firebase CLI installed and configured.
2.  **Firebase Project:**
    * Set up a Firebase project.
    * Enable Firestore and Authentication.
    * Configure Firebase Hosting and Cloud Functions.
3.  **Environment Variables:**
    * **For Local Development (Firebase Emulator):** Create a `.env.<YOUR_PROJECT_ID>` file (e.g., `.env.chatvibestts`) in the `functions` directory. Add your variables here (e.g., `TWITCH_CLIENT_ID=your_local_test_id`). The Firebase Emulator will load these automatically when running locally.
    * **For Deployed Functions (Live Environment):** Environment variables must be set directly in the Google Cloud Console for your Cloud Function. Navigate to your function in GCP, edit it, and add the variables under "Runtime environment variables." (Note: `.env` files are not deployed with the function code for runtime configuration).
4.  **Install Dependencies:**
    * Navigate to the `functions` directory.
    * Run `npm install` to install backend dependencies.
5.  **Deploy:**
    * Deploy Firebase Hosting and Cloud Functions using the Firebase CLI: `firebase deploy`.

## Usage

**Note:** Access is restricted to approved channels only. If your channel is not on the allow-list, you'll see an access denied message. [Request access via this contact form](https://detekoi.github.io/#contact-me).

1.  Access the hosted application URL.
2.  Click on the "Login with Twitch" button to authenticate.
3.  Once authenticated, you will be redirected to the dashboard.
4.  On the dashboard (for approved channels), you can:
    * View the current status of the ChatVibes bot for your channel.
    * Add the bot to your channel if it's not already active.
    * Remove the bot from your channel if it is active.
    * Access instructions for setting up ChatVibes in OBS.
    * Logout from the application.