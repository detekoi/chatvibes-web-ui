/**
 * Jest setup — runs in each test worker process BEFORE any test file.
 * Ensures FIRESTORE_EMULATOR_HOST is set so that both firebase-admin
 * (in testHelpers) and @google-cloud/firestore (in services/firestore)
 * connect to the emulator instead of production.
 */
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "test-project";
process.env.FUNCTIONS_EMULATOR = "true";
process.env.USE_ENV_SECRETS = "1";

// Non-secret OAuth config. appHelper.ts sets the same values with `||`
// defaults; these cover suites that mount a router directly instead.
process.env.CALLBACK_URL = process.env.CALLBACK_URL || "http://localhost:5001/test-project/us-central1/webUi/auth/twitch/callback";
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5002";
