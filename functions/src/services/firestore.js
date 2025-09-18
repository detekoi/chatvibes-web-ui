/**
 * Firestore service module
 * Handles database initialization and collection constants
 */

const {Firestore, FieldValue} = require("@google-cloud/firestore");

// Initialize Firestore client
let db;
try {
  db = new Firestore();
  console.log("[Firestore] Client initialized successfully.");
} catch (error) {
  console.error("[Firestore] Client initialization error:", error);
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
