/**
 * Firestore service module
 * Handles database initialization and collection constants
 */

import {Firestore, FieldValue} from "@google-cloud/firestore";
import {createLogger} from "../logger";

const logger = createLogger({module: "firestore"});

// Initialize Firestore client
let db: Firestore;
try {
  db = new Firestore();
  logger.info("Client initialized successfully");
} catch (error) {
  logger.error({err: error}, "Client initialization error");
  throw error;
}

// Collection constants
const COLLECTIONS = {
  MANAGED_CHANNELS: "managedChannels",
  TTS_CHANNEL_CONFIGS: "ttsChannelConfigs",
  MUSIC_SETTINGS: "musicSettings",
  SHORTLINKS: "shortlinks",
} as const;

export {
  db,
  FieldValue,
  COLLECTIONS,
};
