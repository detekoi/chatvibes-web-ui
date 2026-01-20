/**
 * Configuration module for WildcatTTS Web UI Functions
 * Centralizes environment variables and secret loading
 *
 * Secrets are now loaded from Firebase Functions secret environment variables
 * (mounted from Secret Manager at deploy time) for zero API costs and faster startup.
 */

import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { createLogger } from "./logger";

const secretManagerClient = new SecretManagerServiceClient();
const logger = createLogger({ module: "config" });

// Detect emulator/local mode
const isEmulator = process.env.FUNCTIONS_EMULATOR === "true" || !!process.env.FIREBASE_EMULATOR_HUB || process.env.USE_ENV_SECRETS === "1";

// Define types for secrets and config
interface Secrets {
  TWITCH_CLIENT_ID: string;
  TWITCH_CLIENT_SECRET: string;
  JWT_SECRET: string; // Internal name, loaded from JWT_SECRET_KEY env var
  WAVESPEED_API_KEY: string;
  "302_KEY": string;
}

interface Config {
  CALLBACK_URL: string | undefined;
  FRONTEND_URL: string | undefined;
  OBS_BROWSER_BASE_URL: string;
  GCLOUD_PROJECT: string | undefined;
  TWITCH_BOT_USERNAME: string;
}

// Load secrets directly from environment variables (mounted from Secret Manager)
// These are available immediately at startup, no async loading needed
const secrets: Secrets = {
  TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID || "",
  TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET || "",
  JWT_SECRET: process.env.JWT_SECRET_KEY || process.env.JWT_SECRET || "", // Support both names for compatibility
  WAVESPEED_API_KEY: process.env.WAVESPEED_API_KEY || "",
  "302_KEY": process.env["302_KEY"] || "",
};

// Configuration variables (not secrets)
const config: Config = {
  CALLBACK_URL: process.env.CALLBACK_URL,
  FRONTEND_URL: process.env.FRONTEND_URL,
  OBS_BROWSER_BASE_URL: process.env.OBS_BROWSER_BASE_URL || "https://tts.wildcat.chat",
  GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
  TWITCH_BOT_USERNAME: process.env.TWITCH_BOT_USERNAME || "",
};

// For local dev/emulator, provide defaults if secrets are not set
if (isEmulator && !secrets.TWITCH_CLIENT_ID) {
  secrets.TWITCH_CLIENT_ID = "demo-client-id";
  secrets.TWITCH_CLIENT_SECRET = "demo-client-secret";
  secrets.JWT_SECRET = "local-dev-jwt-secret";
  logger.info("Using demo secrets for emulator mode");
}

// Validate secrets lazily - only when actually needed (not during build/analysis)
// During Firebase's build phase, secrets aren't available yet, so we defer validation
// to runtime when the function is actually invoked
let secretsValidated = false;

// Store original values to avoid infinite recursion when validating
const originalSecrets = { ...secrets };

function validateSecrets(): void {
  if (secretsValidated) return;

  // Skip validation during build/analysis phase
  // Firebase sets FUNCTION_TARGET at runtime, not during build
  const isBuildPhase = !process.env.FUNCTION_TARGET && !isEmulator;
  if (isBuildPhase) {
    logger.debug("Skipping secret validation during build phase");
    return;
  }

  if (!isEmulator) {
    const missingSecrets: string[] = [];
    const presentSecrets: string[] = [];
    // Access originalSecrets directly to avoid infinite recursion
    if (!originalSecrets.TWITCH_CLIENT_ID) missingSecrets.push("TWITCH_CLIENT_ID");
    else presentSecrets.push("TWITCH_CLIENT_ID");
    if (!originalSecrets.TWITCH_CLIENT_SECRET) missingSecrets.push("TWITCH_CLIENT_SECRET");
    else presentSecrets.push("TWITCH_CLIENT_SECRET");
    if (!originalSecrets.JWT_SECRET) missingSecrets.push("JWT_SECRET_KEY (or JWT_SECRET)");
    else presentSecrets.push("JWT_SECRET");
    if (!originalSecrets.WAVESPEED_API_KEY) missingSecrets.push("WAVESPEED_API_KEY");
    else presentSecrets.push("WAVESPEED_API_KEY");
    if (!originalSecrets["302_KEY"]) missingSecrets.push("302_KEY");
    else presentSecrets.push("302_KEY");

    if (missingSecrets.length > 0) {
      logger.error({
        missing: missingSecrets,
        present: presentSecrets,
        functionTarget: process.env.FUNCTION_TARGET,
        gcloudProject: process.env.GCLOUD_PROJECT,
      }, "CRITICAL: Required secrets not found in environment. Verify firebase.json secretEnvironmentVariables configuration and ensure secrets exist in Secret Manager.");
      const error = new Error(
        `Missing required secrets: ${missingSecrets.join(", ")}. ` +
        `Present secrets: ${presentSecrets.join(", ")}. ` +
        `Verify that secrets are configured in firebase.json and exist in Secret Manager with matching names.`
      );
      throw error;
    }
  }

  secretsValidated = true;
  logger.info("Configuration loaded successfully (secrets from environment variables)");
}

// Validate on first access to secrets (lazy validation)
// This ensures validation happens at runtime, not during build
Object.keys(secrets).forEach((key) => {
  Object.defineProperty(secrets, key, {
    get() {
      validateSecrets();
      return originalSecrets[key as keyof Secrets];
    },
    set(value: string) {
      originalSecrets[key as keyof Secrets] = value;
    },
    enumerable: true,
    configurable: true,
  });
});

// Secrets are now available immediately, so this promise resolves right away
// Kept for backward compatibility with code that awaits secretsLoadedPromise
const secretsLoadedPromise = Promise.resolve();

export {
  secrets,
  secretsLoadedPromise,
  config,
  secretManagerClient,
};
export type { Secrets, Config };
