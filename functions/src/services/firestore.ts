/**
 * Firestore service module
 * Handles database initialization and collection constants
 */

import { Firestore, FieldValue, FieldPath } from "@google-cloud/firestore";
import { createLogger } from "../logger";

const logger = createLogger({ module: "firestore" });

// Initialize Firestore client
let db: Firestore;
try {
  db = new Firestore();
  logger.info("Client initialized successfully");
} catch (error) {
  logger.error({ err: error }, "Client initialization error");
  throw error;
}

// Collection constants
const COLLECTIONS = {
  MANAGED_CHANNELS: "managedChannels",
  TTS_CHANNEL_CONFIGS: "ttsChannelConfigs",
  SHORTLINKS: "shortlinks",
  TTS_USER_PREFS: "ttsUserPreferences",
} as const;

export {
  db,
  FieldValue,
  // Needed to delete a pronunciation entry: its segments are taken literally,
  // whereas a dotted string path is parsed and would mis-target any key
  // containing a space, hyphen or dot.
  FieldPath,
  COLLECTIONS,
};
