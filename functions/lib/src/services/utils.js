"use strict";
/**
 * Utility functions used across the application
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getProjectId = getProjectId;
exports.normalizeSecretVersionPath = normalizeSecretVersionPath;
exports.getAllowedChannelsList = getAllowedChannelsList;
exports.validateSpeed = validateSpeed;
exports.validatePitch = validatePitch;
exports.normalizeEmotion = normalizeEmotion;
exports.validateEmotion = validateEmotion;
exports.validateLanguageBoost = validateLanguageBoost;
exports.createShortLink = createShortLink;
const crypto_1 = require("crypto");
const firestore_1 = require("./firestore");
const logger_1 = require("../logger");
/**
 * Gets the current Google Cloud project ID
 * @return The project ID
 */
function getProjectId() {
    const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
    if (!projectId) {
        logger_1.logger.error("Project ID not found in environment variables.");
        throw new Error("Project ID not configured.");
    }
    return projectId;
}
/**
 * Normalizes a secret version path
 * @param secretInput - The secret input to normalize
 * @return The normalized secret path
 */
function normalizeSecretVersionPath(secretInput) {
    if (secretInput.includes("/versions/")) {
        return secretInput;
    }
    return `${secretInput}/versions/latest`;
}
/**
 * Gets the list of allowed channels from environment or secret
 * @return Array of allowed channels or null if no restrictions
 */
async function getAllowedChannelsList() {
    try {
        const directList = process.env.ALLOWED_CHANNELS;
        if (directList) {
            const list = directList.split(",")
                .map((channel) => channel.trim().toLowerCase())
                .filter(Boolean);
            logger_1.logger.info({ count: list.length, channels: list }, "[AllowList] Loaded entries from ALLOWED_CHANNELS");
            return list;
        }
        const secretName = process.env.ALLOWED_CHANNELS_SECRET_NAME;
        if (!secretName) {
            logger_1.logger.info("[AllowList] No ALLOWED_CHANNELS or ALLOWED_CHANNELS_SECRET_NAME configured. No channel restrictions.");
            return null;
        }
        const { secretManagerClient } = await Promise.resolve().then(() => __importStar(require("../config")));
        const [version] = await secretManagerClient.accessSecretVersion({
            name: normalizeSecretVersionPath(secretName),
        });
        const data = version.payload?.data;
        if (!data) {
            throw new Error("Secret has no data");
        }
        const secretValue = data.toString().trim();
        const list = secretValue.split(",")
            .map((channel) => channel.trim().toLowerCase())
            .filter(Boolean);
        logger_1.logger.info({ count: list.length, channels: list }, "[AllowList] Loaded entries from ALLOWED_CHANNELS_SECRET_NAME");
        return list;
    }
    catch (e) {
        const error = e;
        logger_1.logger.error({ error: error.message }, "[AllowList] Error loading allow-list");
        const hasConfig = process.env.ALLOWED_CHANNELS || process.env.ALLOWED_CHANNELS_SECRET_NAME;
        if (hasConfig) {
            logger_1.logger.error("[AllowList] Allow-list configured but failed to load. Denying all for security.");
            return [];
        }
        else {
            logger_1.logger.info("[AllowList] No allow-list configured and no error loading. Allowing all channels.");
            return null;
        }
    }
}
/**
 * Validates TTS speed parameter
 * @param speed - The speed value to validate
 * @return True if valid
 */
function validateSpeed(speed) {
    return typeof speed === "number" && speed >= 0.5 && speed <= 2.0;
}
/**
 * Validates TTS pitch parameter
 * @param pitch - The pitch value to validate
 * @return True if valid
 */
function validatePitch(pitch) {
    return typeof pitch === "number" && pitch >= -12 && pitch <= 12;
}
/**
 * Normalizes common emotion synonyms to canonical tokens
 * @param emotion - Raw emotion value (may be capitalized or a synonym)
 * @return Canonical token or null
 */
function normalizeEmotion(emotion) {
    if (emotion === null || emotion === undefined || emotion === "")
        return null;
    const raw = String(emotion).trim().toLowerCase();
    // Synonym map to canonical tokens used across the app/backend providers
    const map = {
        "auto": "neutral", // Wavespeed doesn't support "auto", map to "neutral"
        "neutral": "neutral",
        "happy": "happy",
        "sad": "sad",
        "angry": "angry",
        // canonical per provider schema
        "fearful": "fearful",
        "disgusted": "disgusted",
        "surprised": "surprised",
        // legacy/synonyms mapped to provider canonical
        "fear": "fearful",
        "surprise": "surprised",
        "disgust": "disgusted",
    };
    return map[raw] || raw;
}
/**
 * Validates TTS emotion parameter
 * @param emotion - The emotion value to validate (canonical or synonym)
 * @return True if valid
 */
function validateEmotion(emotion) {
    if (emotion === null)
        return true;
    const e = normalizeEmotion(emotion);
    // Wavespeed AI supported emotions (no "auto")
    const validEmotions = ["neutral", "happy", "sad", "angry", "fearful", "disgusted", "surprised"];
    return typeof e === "string" && validEmotions.includes(e);
}
/**
 * Validates language boost parameter
 * @param languageBoost - The language boost value to validate
 * @return True if valid
 */
function validateLanguageBoost(languageBoost) {
    // Wavespeed AI language boost options
    const validLanguages = [
        "auto", "English", "Chinese", "Chinese,Yue", "Spanish", "Hindi",
        "Portuguese", "Russian", "Japanese", "Korean", "Vietnamese", "Arabic",
        "French", "German", "Turkish", "Dutch", "Ukrainian", "Indonesian",
        "Italian", "Thai", "Polish", "Romanian", "Greek", "Czech", "Finnish",
    ];
    return typeof languageBoost === "string" && validLanguages.includes(languageBoost);
}
/**
 * Creates a short link and stores it in Firestore
 * @param longUrl - The URL to shorten
 * @return The generated slug
 */
async function createShortLink(longUrl) {
    try {
        new URL(longUrl);
    }
    catch (error) {
        throw new Error("Invalid URL provided");
    }
    const slug = (0, crypto_1.randomBytes)(6).toString("hex");
    await firestore_1.db.collection(firestore_1.COLLECTIONS.SHORTLINKS).doc(slug).set({
        url: longUrl,
        createdAt: new Date(),
        clicks: 0,
    });
    logger_1.logger.info({ slug, url: longUrl }, "Created short link");
    return slug;
}
//# sourceMappingURL=utils.js.map