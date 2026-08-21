/**
 * Channel settings API routes (TTS)
 */

import express, { Response, Router, RequestHandler } from "express";
import { db, COLLECTIONS, FieldValue, FieldPath } from "../services/firestore";
import { authenticateApiRequest, authorizeChannelAccess, AuthenticatedRequest } from "../middleware/auth";
import { logger } from "../logger";
import { errorResponse } from "./utils";
import { validateSpeed, validatePitch, validateEmotion, validateLanguageBoost } from "../services/utils";
import { RELEASED_VOICES } from "../services/voice-list";
import { normalizeMatchKey, validateSay, PRONUNCIATION_LIMITS } from "../services/pronunciation";
import { getUserByUsername } from "../services/twitch";
import { secrets } from "../config";
import { buildIgnoreEntry, IGNORE_SOURCE_MODERATOR } from "../services/ignoreEntries";

const router: Router = express.Router();

const VOICE_IDS = new Set(RELEASED_VOICES);

// ==========================================
// TTS SETTINGS
// ==========================================

const BOOLEAN_SETTINGS = [
    "engineEnabled",
    "speakEvents",
    "speakCheerEvents",
    "speakRedemptionEvents",
    "announceUnfulfilledRedemptions",
    "speakWatchStreakEvents",
    "anonymizeFollowers",
    "bitsModeEnabled",
    "readFullUrls",
    "allowViewerPreferences",
    "botRespondsInChat",
    "englishNormalization",
    "youtubeEnabled",
    "pronunciationEnabled",
    "profanityFilterEnabled",
];

/**
 * Validates a single channel setting before it is merged into the channel's
 * config document. This is the only writer for these keys, so anything not
 * listed here is rejected rather than silently stored.
 * @param key - The setting key being written
 * @param value - The proposed value
 * @return True if the key is known and the value is well-formed
 */
function validateTtsSetting(key: string, value: unknown): boolean {
    if (BOOLEAN_SETTINGS.includes(key)) return typeof value === "boolean";

    switch (key) {
    case "mode":
        return ["all", "command", "bits_points_only"].includes(value as string);
    case "ttsPermissionLevel":
        return ["everyone", "subs", "mods", "vip"].includes(value as string);
    case "emoteMode":
        return ["read", "skip", "describe"].includes(value as string);
    case "emotion":
        // "auto" means "send no emotion override"; the bot handles it explicitly.
        return value === "auto" || (typeof value === "string" && validateEmotion(value));
    case "languageBoost":
        // The dashboard dropdown offers "Automatic"; the bot maps that (and the
        // legacy "None") onto "auto" before calling the TTS API.
        return value === "Automatic" || value === "None" || validateLanguageBoost(value as string);
    case "pitch":
        return validatePitch(value as number);
    case "speed":
        return validateSpeed(value as number);
    case "bitsMinimumAmount":
        return typeof value === "number" && Number.isInteger(value) && value >= 0;
    case "voiceId":
        return typeof value === "string" && VOICE_IDS.has(value);
    case "youtubeHandle":
        return typeof value === "string" && value.length <= 100;
    default:
        // Voice IDs are not restricted to a simple charset — many contain
        // hyphens, spaces and parentheses ("Chinese (Mandarin)_News_Anchor") —
        // so match the prefix and check the remainder against the voice list.
        if (key.startsWith("voiceVolumes.")) {
            return VOICE_IDS.has(key.slice("voiceVolumes.".length)) &&
                typeof value === "number" && value > 0 && value <= 10;
        }
        return false;
    }
}

// GET /tts/settings/channel/:channelName
router.get("/tts/settings/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
        const docSnap = await docRef.get();

        if (docSnap.exists) {
            res.json({ settings: docSnap.data() || {} });
        } else {
            res.json({ settings: {} });
        }
    } catch (error) {
        logger.error({ error, channelName }, "Error fetching TTS settings");
        errorResponse(res, 500, "Failed to fetch TTS settings");
    }
}) as RequestHandler);

// PUT /tts/settings/channel/:channelName
router.put("/tts/settings/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { key, value } = req.body;

    if (!key) {
        errorResponse(res, 400, "Key is required");
        return;
    }

    if (!validateTtsSetting(key, value)) {
        logger.warn({ channelName, key, value }, "Rejected invalid TTS setting");
        errorResponse(res, 400, `Invalid setting: ${key}`);
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);

        // set() treats a dotted key as a literal field name, not a path, so
        // "voiceVolumes.<voiceId>" has to be written as a nested map for the bot
        // to find it under config.voiceVolumes. merge:true keeps sibling voices.
        const update = key.startsWith("voiceVolumes.") ?
            { voiceVolumes: { [key.slice("voiceVolumes.".length)]: value } } :
            { [key]: value };

        await docRef.set(update, { merge: true });

        logger.info({ channelName, key, value }, "Updated TTS setting");
        res.json({ success: true, message: "Setting updated" });
    } catch (error) {
        logger.error({ error, channelName, key }, "Error updating TTS settings");
        errorResponse(res, 500, "Failed to update TTS setting");
    }
}) as RequestHandler);

// ==========================================
// TTS IGNORE LIST MANAGEMENT
// ==========================================
//
// Entries are keyed by immutable Twitch user ID ("twitch:<id>") rather than by
// login, so renaming an account does not shed its entry and reclaiming a
// released login does not inherit one. The stored value is a record of who
// imposed the entry, with a display name kept only so the list has something
// readable to render. The bot writes the same map; see src/lib/ignoreList.js in
// the tts-twitch repo for the format, mirrored here in services/ignoreEntries.ts.
//
// Everything added through here is moderator-imposed: authorizeChannelAccess
// requires req.user.userLogin to equal the channel name, so the caller is always
// the broadcaster acting on someone else. That is what stops the target lifting
// it themselves from the viewer settings page.

// POST /tts/ignore/channel/:channelName - Add user to ignore list
router.post("/tts/ignore/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { username } = req.body;

    if (!username || typeof username !== "string") {
        errorResponse(res, 400, "Username is required");
        return;
    }

    const normalizedUsername = username.toLowerCase().trim().replace(/^@/, "");
    if (!normalizedUsername) {
        errorResponse(res, 400, "Invalid username");
        return;
    }

    try {
        // Resolving here is what makes the entry durable. A name that does not
        // resolve is rejected outright rather than stored — a stored name that
        // matches no account would sit in the list looking effective forever.
        const account = await getUserByUsername(normalizedUsername, secrets);
        if (!account) {
            errorResponse(res, 404, `No Twitch account named "${normalizedUsername}" exists`);
            return;
        }

        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
        // merge:true deep-merges nested maps key by key, so this touches only
        // the one entry and leaves the rest of the list alone.
        await docRef.set({
            ignoredUserIds: {
                [`twitch:${account.id}`]: buildIgnoreEntry({
                    label: account.displayName,
                    source: IGNORE_SOURCE_MODERATOR,
                    by: `twitch:${req.user.userId}`,
                }),
            },
        }, { merge: true });

        logger.info({ channelName, userId: account.id, username: account.login }, "Added user to TTS ignore list");
        res.json({
            success: true,
            message: "User added to ignore list",
            entry: { key: `twitch:${account.id}`, label: account.displayName },
        });
    } catch (error) {
        logger.error({ error, channelName, username }, "Error adding user to ignore list");
        errorResponse(res, 500, "Failed to add user to ignore list");
    }
}) as RequestHandler);

// DELETE /tts/ignore/channel/:channelName - Remove user from ignore list
router.delete("/tts/ignore/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { key } = req.body;

    if (!key || typeof key !== "string") {
        errorResponse(res, 400, "Entry key is required");
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
        // FieldPath segments are taken literally. A dotted string would be parsed
        // as a path instead, and these keys contain a colon separator.
        await docRef.update(new FieldPath("ignoredUserIds", key), FieldValue.delete());

        logger.info({ channelName, key }, "Removed user from TTS ignore list");
        res.json({ success: true, message: "User removed from ignore list" });
    } catch (error) {
        // 5 is NOT_FOUND: the entry was already gone, which is the desired end state.
        if ((error as { code?: number }).code === 5) {
            res.json({ success: true, message: "User removed from ignore list" });
            return;
        }
        logger.error({ error, channelName, key }, "Error removing user from ignore list");
        errorResponse(res, 500, "Failed to remove user from ignore list");
    }
}) as RequestHandler);

// ==========================================
// TTS BANNED WORDS MANAGEMENT
// ==========================================

// POST /tts/banned-words/channel/:channelName - Add word to banned list
router.post("/tts/banned-words/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { word } = req.body;

    if (!word || typeof word !== "string") {
        errorResponse(res, 400, "Word or phrase is required");
        return;
    }

    const normalizedWord = word.toLowerCase().trim();
    if (!normalizedWord) {
        errorResponse(res, 400, "Invalid word or phrase");
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
        await docRef.set({ bannedWords: FieldValue.arrayUnion(normalizedWord) }, { merge: true });

        logger.info({ channelName, word: normalizedWord }, "Added word to TTS banned list");
        res.json({ success: true, message: "Word added to banned list" });
    } catch (error) {
        logger.error({ error, channelName, word }, "Error adding word to banned list");
        errorResponse(res, 500, "Failed to add word to banned list");
    }
}) as RequestHandler);

// DELETE /tts/banned-words/channel/:channelName - Remove word from banned list
router.delete("/tts/banned-words/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { word } = req.body;

    if (!word || typeof word !== "string") {
        errorResponse(res, 400, "Word or phrase is required");
        return;
    }

    const normalizedWord = word.toLowerCase().trim();
    if (!normalizedWord) {
        errorResponse(res, 400, "Invalid word or phrase");
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
        await docRef.set({ bannedWords: FieldValue.arrayRemove(normalizedWord) }, { merge: true });

        logger.info({ channelName, word: normalizedWord }, "Removed word from TTS banned list");
        res.json({ success: true, message: "Word removed from banned list" });
    } catch (error) {
        logger.error({ error, channelName, word }, "Error removing word from banned list");
        errorResponse(res, 500, "Failed to remove word from banned list");
    }
}) as RequestHandler);

// ==========================================
// PRONUNCIATION DICTIONARY
// ==========================================
//
// A map field rather than an array, so the arrayUnion/arrayRemove shape used by
// the banned-word list does not apply. These get dedicated routes
// rather than riding on PUT /tts/settings because that path cannot express a
// delete, cannot read-before-write to enforce the entry cap, and can only
// report "Invalid setting: <key>" where a form needs an actionable message.

// POST /tts/pronunciations/channel/:channelName - Add or update an entry
router.post("/tts/pronunciations/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { match, say } = req.body;

    const normalizedMatch = normalizeMatchKey(match);
    if (!normalizedMatch) {
        errorResponse(res, 400, `Word must be 1-${PRONUNCIATION_LIMITS.MAX_MATCH_LENGTH} characters using letters, digits, apostrophes or hyphens, and cannot contain a dot`);
        return;
    }

    const normalizedSay = validateSay(say);
    if (!normalizedSay.ok) {
        errorResponse(res, 400, `Pronunciation ${normalizedSay.reason}`);
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);

        // The cap counts stored entries, so updating an existing key is always
        // allowed even at the limit. hasOwn rather than `in`, which also sees
        // Object.prototype members: "constructor" is a legal match key and would
        // otherwise look like an existing entry and skip the cap check.
        const snap = await docRef.get();
        const existing = (snap.exists ? snap.data()?.pronunciations : null) || {};
        const isNew = !Object.hasOwn(existing, normalizedMatch);
        if (isNew && Object.keys(existing).length >= PRONUNCIATION_LIMITS.MAX_CUSTOM_ENTRIES) {
            errorResponse(res, 400, `Limit of ${PRONUNCIATION_LIMITS.MAX_CUSTOM_ENTRIES} custom pronunciations reached. Remove one first.`);
            return;
        }

        // merge:true deep-merges nested maps, so this touches only this key.
        await docRef.set({ pronunciations: { [normalizedMatch]: normalizedSay.value } }, { merge: true });

        logger.info({ channelName, match: normalizedMatch }, "Set TTS pronunciation");
        res.json({ success: true, message: "Pronunciation saved", match: normalizedMatch, say: normalizedSay.value });
    } catch (error) {
        logger.error({ error, channelName, match }, "Error setting TTS pronunciation");
        errorResponse(res, 500, "Failed to save pronunciation");
    }
}) as RequestHandler);

// DELETE /tts/pronunciations/channel/:channelName - Remove an entry
router.delete("/tts/pronunciations/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { match } = req.body;

    const normalizedMatch = normalizeMatchKey(match);
    if (!normalizedMatch) {
        errorResponse(res, 400, "Word is required");
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
        // FieldPath segments are literal. A dotted string would be parsed, so a
        // key containing a space or hyphen would need backtick quoting.
        await docRef.update(new FieldPath("pronunciations", normalizedMatch), FieldValue.delete());

        logger.info({ channelName, match: normalizedMatch }, "Removed TTS pronunciation");
        res.json({ success: true, message: "Pronunciation removed" });
    } catch (error) {
        // 5 is NOT_FOUND: the entry is already gone, which is the desired state.
        if ((error as { code?: number }).code === 5) {
            res.json({ success: true, message: "Pronunciation removed" });
            return;
        }
        logger.error({ error, channelName, match }, "Error removing TTS pronunciation");
        errorResponse(res, 500, "Failed to remove pronunciation");
    }
}) as RequestHandler);

export default router;
