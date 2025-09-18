/**
 * Configuration module for ChatVibes Web UI Functions
 * Centralizes environment variables and secret loading
 */

const {SecretManagerServiceClient} = require("@google-cloud/secret-manager");

const secretManagerClient = new SecretManagerServiceClient();

// Global variables for secrets
let secrets = {};

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
    const [
      twitchClientId,
      twitchClientSecret,
      jwtSecret,
      replicateApiToken,
    ] = await Promise.all([
      loadSecret("twitch-webui-client-id"),
      loadSecret("twitch-webui-client-secret"),
      loadSecret("jwt-secret-key"),
      loadSecret("replicate-api-token"),
    ]);

    secrets = {
      TWITCH_CLIENT_ID: twitchClientId,
      TWITCH_CLIENT_SECRET: twitchClientSecret,
      JWT_SECRET: jwtSecret,
      REPLICATE_API_TOKEN: replicateApiToken,
    };

    console.log("✅ Successfully loaded all required secrets.");
  } catch (error) {
    console.error("CRITICAL: Failed to load secrets on startup.", error);
    throw new Error("Could not load necessary secrets to start the function.");
  }
})();

// Configuration variables (not secrets)
const config = {
  CALLBACK_URL: process.env.CALLBACK_URL,
  FRONTEND_URL: process.env.FRONTEND_URL,
  OBS_BROWSER_BASE_URL: process.env.OBS_BROWSER_BASE_URL || "https://chatvibes-tts-service-h7kj56ct4q-uc.a.run.app",
  GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
};

module.exports = {
  secrets,
  secretsLoadedPromise,
  config,
  secretManagerClient,
};
