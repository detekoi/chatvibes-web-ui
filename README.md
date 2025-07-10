# ChatVibes Bot Management

## Description

ChatVibes Bot Management is a web application that allows Twitch streamers to manage the [ChatVibes **Text-to-Speech (TTS)** bot](https://github.com/detekoi/chatvibes) for their channel. Users can log in with their Twitch account to add or remove the bot, and view its current status. The application features a dynamic, animated background.

Currently, the ChatVibes web UI is hosted [here](https://chatvibestts.web.app/).

## Features

* **Twitch Authentication:** Users can log in securely using their Twitch account.
* **Bot Management:** Add or remove the ChatVibes bot from your Twitch channel through a simple interface.
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

1.  Access the hosted application URL.
2.  Click on the "Login with Twitch" button to authenticate.
3.  Once authenticated, you will be redirected to the dashboard.
4.  On the dashboard, you can:
    * View the current status of the ChatVibes bot for your channel.
    * Add the bot to your channel if it's not already active.
    * Remove the bot from your channel if it is active.
    * Access instructions for setting up ChatVibes in OBS.
    * Logout from the application.