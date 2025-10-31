/**
 * Configuration module for ChatVibes Web UI Functions
 * Centralizes environment variables and secret loading
 */

const {SecretManagerServiceClient} = require("@google-cloud/secret-manager");

const secretManagerClient = new SecretManagerServiceClient();

// Detect emulator/local mode to avoid Secret Manager access during local testing
const isEmulator = process.env.FUNCTIONS_EMULATOR === "true" || !!process.env.FIREBASE_EMULATOR_HUB || process.env.USE_ENV_SECRETS === "1";

// Global variables for secrets
// Important: export a stable object reference and mutate its properties later
// so that require() consumers always see the updated values.
const secrets = {};

// Helper function to load a secret from Secret Manager
const loadSecret = async (secretName) => {
  const [version] = await secretManagerClient.accessSecretVersion({
    name: `projects/${process.env.GCLOUD_PROJECT}/secrets/${secretName}/versions/latest`,
  });
  return version.payload.data.toString().trim();
};

// Asynchronously load all secrets when the module is imported
const secretsLoadedPromise = (async () => {
  try {
    if (isEmulator) {
      secrets.TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || "demo-client-id";
      secrets.TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || "demo-client-secret";
      secrets.JWT_SECRET = process.env.JWT_SECRET || "local-dev-jwt-secret";
      secrets.WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY || "";
      config.TWITCH_BOT_USERNAME = process.env.TWITCH_BOT_USERNAME || "";
      console.log("✅ Loaded secrets from environment (emulator mode).");
      return;
    }

    const [
      twitchClientId,
      twitchClientSecret,
      jwtSecret,
      wavespeedApiKey,
      botUsername,
    ] = await Promise.all([
      loadSecret("twitch-client-id"),
      loadSecret("twitch-client-secret"),
      loadSecret("jwt-secret-key"),
      loadSecret("WAVESPEED_API_KEY"),
      loadSecret("twitch-bot-username").catch(() => null), // Bot username is optional if stored as secret
    ]);

    secrets.TWITCH_CLIENT_ID = twitchClientId;
    secrets.TWITCH_CLIENT_SECRET = twitchClientSecret;
    secrets.JWT_SECRET = jwtSecret;
    secrets.WAVESPEED_API_KEY = wavespeedApiKey;
    // Bot username can be from secret or env var
    config.TWITCH_BOT_USERNAME = botUsername || process.env.TWITCH_BOT_USERNAME || "";

    console.log("✅ Successfully loaded all required secrets.");
  } catch (error) {
    console.error("CRITICAL: Failed to load secrets on startup.", error);
    throw new Error("Could not load necessary secrets to start the function.");
  }
})();

// Configuration variables (not secrets)
// Important: Bot username is loaded from secret or env var in secretsLoadedPromise
const config = {
  CALLBACK_URL: process.env.CALLBACK_URL,
  FRONTEND_URL: process.env.FRONTEND_URL,
  OBS_BROWSER_BASE_URL: process.env.OBS_BROWSER_BASE_URL || "https://chatvibes-tts-service-h7kj56ct4q-uc.a.run.app",
  GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
  TWITCH_BOT_USERNAME: "", // Set during secretsLoadedPromise
};

module.exports = {
  secrets,
  secretsLoadedPromise,
  config,
  secretManagerClient,
};
