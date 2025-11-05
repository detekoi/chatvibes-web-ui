"use strict";
/**
 * Firestore service module
 * Handles database initialization and collection constants
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLLECTIONS = exports.FieldValue = exports.db = void 0;
const firestore_1 = require("@google-cloud/firestore");
Object.defineProperty(exports, "FieldValue", { enumerable: true, get: function () { return firestore_1.FieldValue; } });
const logger_1 = require("../logger");
const logger = (0, logger_1.createLogger)({ module: "firestore" });
// Initialize Firestore client
let db;
try {
    exports.db = db = new firestore_1.Firestore();
    logger.info("Client initialized successfully");
}
catch (error) {
    logger.error({ err: error }, "Client initialization error");
    throw error;
}
// Collection constants
const COLLECTIONS = {
    MANAGED_CHANNELS: "managedChannels",
    TTS_CHANNEL_CONFIGS: "ttsChannelConfigs",
    MUSIC_SETTINGS: "musicSettings",
    SHORTLINKS: "shortlinks",
};
exports.COLLECTIONS = COLLECTIONS;
//# sourceMappingURL=firestore.js.map