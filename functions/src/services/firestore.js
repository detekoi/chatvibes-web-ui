/**
 * Firestore service module
 * Handles database initialization and collection constants
 */

const {Firestore, FieldValue} = require("@google-cloud/firestore");
const {createLogger} = require("../logger");

const logger = createLogger({module: "firestore"});

// Initialize Firestore client
let db;
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
};

module.exports = {
  db,
  FieldValue,
  COLLECTIONS,
};
