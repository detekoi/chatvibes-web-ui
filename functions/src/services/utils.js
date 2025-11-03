/**
 * Utility functions used across the application
 */

const crypto = require("crypto");
const {db, COLLECTIONS} = require("./firestore");
const {logger} = require("../logger");

/**
 * Gets the current Google Cloud project ID
 * @return {string} The project ID
 */
function getProjectId() {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    logger.error("Project ID not found in environment variables.");
    throw new Error("Project ID not configured.");
  }
  return projectId;
}

/**
 * Normalizes a secret version path
 * @param {string} secretInput - The secret input to normalize
 * @return {string} The normalized secret path
 */
function normalizeSecretVersionPath(secretInput) {
  if (secretInput.includes("/versions/")) {
    return secretInput;
  }
  return `${secretInput}/versions/latest`;
}

/**
 * Gets the list of allowed channels from environment or secret
 * @return {Promise<Array<string>|null>} Array of allowed channels or null if no restrictions
 */
async function getAllowedChannelsList() {
  try {
    const directList = process.env.ALLOWED_CHANNELS;
    if (directList) {
      const list = directList.split(",")
          .map((channel) => channel.trim().toLowerCase())
          .filter(Boolean);
      logger.info({count: list.length, channels: list}, "[AllowList] Loaded entries from ALLOWED_CHANNELS");
      return list;
    }

    const secretName = process.env.ALLOWED_CHANNELS_SECRET_NAME;
    if (!secretName) {
      logger.info("[AllowList] No ALLOWED_CHANNELS or ALLOWED_CHANNELS_SECRET_NAME configured. No channel restrictions.");
      return null;
    }

    const {secretManagerClient} = require("../config");
    const [version] = await secretManagerClient.accessSecretVersion({
      name: normalizeSecretVersionPath(secretName),
    });
    const secretValue = version.payload.data.toString().trim();

    const list = secretValue.split(",")
        .map((channel) => channel.trim().toLowerCase())
        .filter(Boolean);
    logger.info({count: list.length, channels: list}, "[AllowList] Loaded entries from ALLOWED_CHANNELS_SECRET_NAME");
    return list;
  } catch (e) {
    logger.error({error: e.message}, "[AllowList] Error loading allow-list");
    const hasConfig = process.env.ALLOWED_CHANNELS || process.env.ALLOWED_CHANNELS_SECRET_NAME;
    if (hasConfig) {
      logger.error("[AllowList] Allow-list configured but failed to load. Denying all for security.");
      return [];
    } else {
      logger.info("[AllowList] No allow-list configured and no error loading. Allowing all channels.");
      return null;
    }
  }
}

/**
 * Validates TTS speed parameter
 * @param {number} speed - The speed value to validate
 * @return {boolean} True if valid
 */
function validateSpeed(speed) {
  return typeof speed === "number" && speed >= 0.5 && speed <= 2.0;
}

/**
 * Validates TTS pitch parameter
 * @param {number} pitch - The pitch value to validate
 * @return {boolean} True if valid
 */
function validatePitch(pitch) {
  return typeof pitch === "number" && pitch >= -12 && pitch <= 12;
}

/**
 * Normalizes common emotion synonyms to canonical tokens
 * @param {string|null} emotion - Raw emotion value (may be capitalized or a synonym)
 * @return {string|null} Canonical token or null
 */
function normalizeEmotion(emotion) {
  if (emotion === null || emotion === undefined || emotion === "") return null;
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
 * @param {string} emotion - The emotion value to validate (canonical or synonym)
 * @return {boolean} True if valid
 */
function validateEmotion(emotion) {
  if (emotion === null) return true;
  const e = normalizeEmotion(emotion);
  // Wavespeed AI supported emotions (no "auto")
  const validEmotions = ["neutral", "happy", "sad", "angry", "fearful", "disgusted", "surprised"];
  return typeof e === "string" && validEmotions.includes(e);
}

/**
 * Validates language boost parameter
 * @param {string} languageBoost - The language boost value to validate
 * @return {boolean} True if valid
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
 * @param {string} longUrl - The URL to shorten
 * @return {Promise<string>} The generated slug
 */
async function createShortLink(longUrl) {
  try {
    new URL(longUrl);
  } catch (error) {
    throw new Error("Invalid URL provided");
  }

  const slug = crypto.randomBytes(6).toString("hex");

  await db.collection(COLLECTIONS.SHORTLINKS).doc(slug).set({
    url: longUrl,
    createdAt: new Date(),
    clicks: 0,
  });

  logger.info({slug, url: longUrl}, "Created short link");
  return slug;
}

module.exports = {
  getProjectId,
  normalizeSecretVersionPath,
  getAllowedChannelsList,
  validateSpeed,
  validatePitch,
  normalizeEmotion,
  validateEmotion,
  validateLanguageBoost,
  createShortLink,
};
