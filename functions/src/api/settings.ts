/**
 * Channel settings API routes (TTS)
 */

import express, { Response, Router, RequestHandler } from "express";
import { db, COLLECTIONS, FieldValue, FieldPath } from "../services/firestore";
import { authenticateApiRequest, authorizeChannelAccess, AuthenticatedRequest } from "../middleware/auth";
import { logger } from "../logger";
import { apiError } from "./utils";
import { validateSpeed, validatePitch, validateEmotion, validateLanguageBoost } from "../services/utils";
import { canonicalVoiceId } from "../services/voices";
import { validateStyle, validateDisabledSoundTags } from "../services/style";
import { normalizeMatchKey, validateSay, PRONUNCIATION_LIMITS } from "../services/pronunciation";
import { getUserByUsername } from "../services/twitch";
import { secrets } from "../config";
import { buildIgnoreEntry, IGNORE_SOURCE_MODERATOR } from "../services/ignoreEntries";
import { buildMutedRewardEntry, isValidRewardId, MUTED_REWARD_TITLE_MAX } from "../services/mutedRewards";

const router: Router = express.Router();

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
    "readCheerMessages",
    "readCommandMessages",
    "readFullUrls",
    "allowViewerPreferences",
    "botRespondsInChat",
    "youtubeEnabled",
    "pronunciationEnabled",
    "profanityFilterEnabled",
];

// Settings of the previous TTS provider. A dashboard cached from before the
// change can still send them, so they are accepted and not stored.
const RETIRED_SETTINGS = ["englishNormalization"];

const VOICE_VOLUME_PREFIX = "voiceVolumes.";
// The characters of the old MiniMax voice IDs, such as "Chinese (Mandarin)_News_Anchor".
const STALE_VOICE_ID = /^[A-Za-z0-9][A-Za-z0-9 _()\-]{0,127}$/;

type PreparedSetting =
    | { ok: true; update: Record<string, unknown> }
    | { ok: false; code: string; error: string; params: Record<string, unknown> };

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
        return ["all", "command", "bits_points_only", "highlighted_only"].includes(value as string);
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
        return typeof value === "number" && Number.isInteger(value) && value >= 1;
    case "youtubeHandle":
        return typeof value === "string" && value.length <= 100;
    default:
        return false;
    }
}

/**
 * Validates one channel setting and builds the fields to merge into the
 * channel's config document. Some settings also reset a related field.
 * @param key - The setting key being written
 * @param value - The proposed value
 * @return The fields to write, or the error to send
 */
function prepareTtsSetting(key: string, value: unknown): PreparedSetting {
    const invalid: PreparedSetting = { ok: false, code: "setting_invalid", error: `Invalid setting: ${key}`, params: { key } };

    if (key === "voiceId") {
        // A Gemini voice, or a MiniMax voice of the mapping until the backfill ran.
        const voiceId = canonicalVoiceId(value);
        if (!voiceId) return invalid;
        // voiceStyle and voiceLanguage are the manner and the language that the
        // backfill wrote for the voice it replaced.
        return { ok: true, update: { voiceId, voiceStyle: "", voiceLanguage: "" } };
    }

    if (key.startsWith(VOICE_VOLUME_PREFIX)) {
        const rawId = key.slice(VOICE_VOLUME_PREFIX.length);
        // A volume can still be stored under an ID that is no voice any more (a
        // MiniMax ID that the map does not have). The owner must be able to reset
        // it, so a reset to 1 is accepted for any ID that looks like a voice ID.
        const voiceId = canonicalVoiceId(rawId) ?? (value === 1 && STALE_VOICE_ID.test(rawId) ? rawId : null);
        if (!voiceId || typeof value !== "number" || !(value > 0 && value <= 2)) return invalid;
        // set() treats a dotted key as a literal field name, not a path, so
        // "voiceVolumes.<voiceId>" has to be written as a nested map for the bot
        // to find it under config.voiceVolumes. merge:true keeps sibling voices.
        return { ok: true, update: { voiceVolumes: { [voiceId]: value } } };
    }

    if (key === "style") {
        const style = validateStyle(value);
        if (style.ok) return { ok: true, update: { style: style.value } };
        if (style.reasonCode === "style_too_long") {
            const max = style.reasonParams?.max;
            return { ok: false, code: "style_too_long", error: `Style must be ${max} characters or fewer`, params: { key, max } };
        }
        return invalid;
    }

    if (key === "disabledSoundTags") {
        const tags = validateDisabledSoundTags(value);
        if (tags.ok) return { ok: true, update: { disabledSoundTags: tags.value } };
        if (tags.reasonCode === "sound_tag_unknown") {
            const tag = tags.reasonParams?.tag;
            return { ok: false, code: "sound_tag_unknown", error: `Unknown sound tag: ${tag}`, params: { key, tag } };
        }
        return invalid;
    }

    if (!validateTtsSetting(key, value)) return invalid;

    // An emotion preset and a custom style are alternatives. The bot lets the
    // style win, so the new emotion would not be heard while a style is stored.
    if (key === "emotion") return { ok: true, update: { emotion: value, style: "" } };

    return { ok: true, update: { [key]: value } };
}

// GET /tts/settings/channel/:channelName
router.get("/tts/settings/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
        const docSnap = await docRef.get();

        const stored: Record<string, unknown> = { ...((docSnap.exists && docSnap.data()) || {}) };
        for (const retired of RETIRED_SETTINGS) delete stored[retired];
        res.json({
            settings: {
                ...stored,
                style: typeof stored.style === "string" ? stored.style : "",
                disabledSoundTags: Array.isArray(stored.disabledSoundTags) ? stored.disabledSoundTags : [],
            },
        });
    } catch (error) {
        logger.error({ error, channelName }, "Error fetching TTS settings");
        apiError(res, 500, "settings_fetch_failed", "Failed to fetch TTS settings");
    }
}) as RequestHandler);

// PUT /tts/settings/channel/:channelName
router.put("/tts/settings/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { key, value } = req.body;

    if (!key || typeof key !== "string") {
        apiError(res, 400, "key_required", "Key is required");
        return;
    }

    if (RETIRED_SETTINGS.includes(key)) {
        res.json({ success: true, message: "Setting is no longer used" });
        return;
    }

    const prepared = prepareTtsSetting(key, value);
    if (!prepared.ok) {
        logger.warn({ channelName, key, value }, "Rejected invalid TTS setting");
        apiError(res, 400, prepared.code, prepared.error, prepared.params);
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);

        await docRef.set(prepared.update, { merge: true });

        logger.info({ channelName, key, value }, "Updated TTS setting");
        res.json({ success: true, message: "Setting updated" });
    } catch (error) {
        logger.error({ error, channelName, key }, "Error updating TTS settings");
        apiError(res, 500, "setting_update_failed", "Failed to update TTS setting");
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
        apiError(res, 400, "username_required", "Username is required");
        return;
    }

    const normalizedUsername = username.toLowerCase().trim().replace(/^@/, "");
    if (!normalizedUsername) {
        apiError(res, 400, "username_invalid", "Invalid username");
        return;
    }

    try {
        // Resolving here is what makes the entry durable. A name that does not
        // resolve is rejected outright rather than stored — a stored name that
        // matches no account would sit in the list looking effective forever.
        const account = await getUserByUsername(normalizedUsername, secrets);
        if (!account) {
            apiError(res, 404, "twitch_user_not_found", `No Twitch account named "${normalizedUsername}" exists`, { username: normalizedUsername });
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
        apiError(res, 500, "ignore_add_failed", "Failed to add user to ignore list");
    }
}) as RequestHandler);

// DELETE /tts/ignore/channel/:channelName - Remove user from ignore list
router.delete("/tts/ignore/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { key } = req.body;

    if (!key || typeof key !== "string") {
        apiError(res, 400, "entry_key_required", "Entry key is required");
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
        apiError(res, 500, "ignore_remove_failed", "Failed to remove user from ignore list");
    }
}) as RequestHandler);

// ==========================================
// MUTED REWARDS (redemptions that are not announced)
// ==========================================
//
// Same write mechanics as the ignore list: a nested map under merge:true to add,
// a FieldPath delete to remove. The dashboard picks from the reward list Helix
// returns (GET /api/rewards/all), so the ID it sends is one Twitch issued; the
// shape check here only keeps junk out of the map key.

// POST /tts/muted-rewards/channel/:channelName - Stop announcing one reward
router.post("/tts/muted-rewards/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { rewardId, title } = req.body;

    if (!isValidRewardId(rewardId)) {
        apiError(res, 400, "reward_id_invalid", "A reward ID is required");
        return;
    }
    if (typeof title !== "string" || !title.trim() || title.length > MUTED_REWARD_TITLE_MAX) {
        apiError(res, 400, "reward_title_invalid", "A reward title is required");
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
        const entry = buildMutedRewardEntry({ title, by: `twitch:${req.user.userId}` });
        await docRef.set({ mutedRewardIds: { [rewardId]: entry } }, { merge: true });

        logger.info({ channelName, rewardId, title: entry.title }, "Muted reward announcements");
        res.json({ success: true, message: "Reward muted", entry: { rewardId, title: entry.title } });
    } catch (error) {
        logger.error({ error, channelName, rewardId }, "Error muting reward");
        apiError(res, 500, "reward_mute_failed", "Failed to mute reward");
    }
}) as RequestHandler);

// DELETE /tts/muted-rewards/channel/:channelName - Announce one reward again
router.delete("/tts/muted-rewards/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { rewardId } = req.body;

    if (!isValidRewardId(rewardId)) {
        apiError(res, 400, "reward_id_invalid", "A reward ID is required");
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
        await docRef.update(new FieldPath("mutedRewardIds", rewardId), FieldValue.delete());

        logger.info({ channelName, rewardId }, "Unmuted reward announcements");
        res.json({ success: true, message: "Reward unmuted" });
    } catch (error) {
        // 5 is NOT_FOUND: the entry was already gone, which is the desired end state.
        if ((error as { code?: number }).code === 5) {
            res.json({ success: true, message: "Reward unmuted" });
            return;
        }
        logger.error({ error, channelName, rewardId }, "Error unmuting reward");
        apiError(res, 500, "reward_unmute_failed", "Failed to unmute reward");
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
        apiError(res, 400, "word_required", "Word or phrase is required");
        return;
    }

    const normalizedWord = word.toLowerCase().trim();
    if (!normalizedWord) {
        apiError(res, 400, "word_invalid", "Invalid word or phrase");
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
        await docRef.set({ bannedWords: FieldValue.arrayUnion(normalizedWord) }, { merge: true });

        logger.info({ channelName, word: normalizedWord }, "Added word to TTS banned list");
        res.json({ success: true, message: "Word added to banned list" });
    } catch (error) {
        logger.error({ error, channelName, word }, "Error adding word to banned list");
        apiError(res, 500, "banned_add_failed", "Failed to add word to banned list");
    }
}) as RequestHandler);

// DELETE /tts/banned-words/channel/:channelName - Remove word from banned list
router.delete("/tts/banned-words/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { word } = req.body;

    if (!word || typeof word !== "string") {
        apiError(res, 400, "word_required", "Word or phrase is required");
        return;
    }

    const normalizedWord = word.toLowerCase().trim();
    if (!normalizedWord) {
        apiError(res, 400, "word_invalid", "Invalid word or phrase");
        return;
    }

    try {
        const docRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
        await docRef.set({ bannedWords: FieldValue.arrayRemove(normalizedWord) }, { merge: true });

        logger.info({ channelName, word: normalizedWord }, "Removed word from TTS banned list");
        res.json({ success: true, message: "Word removed from banned list" });
    } catch (error) {
        logger.error({ error, channelName, word }, "Error removing word from banned list");
        apiError(res, 500, "banned_remove_failed", "Failed to remove word from banned list");
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
        apiError(res, 400, "match_key_invalid", `Word must be 1-${PRONUNCIATION_LIMITS.MAX_MATCH_LENGTH} characters using letters, digits, apostrophes or hyphens, and cannot contain a dot`, { max: PRONUNCIATION_LIMITS.MAX_MATCH_LENGTH });
        return;
    }

    const normalizedSay = validateSay(say);
    if (!normalizedSay.ok) {
        apiError(res, 400, normalizedSay.reasonCode, `Pronunciation ${normalizedSay.reason}`, normalizedSay.reasonParams);
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
            apiError(res, 400, "pronunciation_limit_reached", `Limit of ${PRONUNCIATION_LIMITS.MAX_CUSTOM_ENTRIES} custom pronunciations reached. Remove one first.`, { max: PRONUNCIATION_LIMITS.MAX_CUSTOM_ENTRIES });
            return;
        }

        // merge:true deep-merges nested maps, so this touches only this key.
        await docRef.set({ pronunciations: { [normalizedMatch]: normalizedSay.value } }, { merge: true });

        logger.info({ channelName, match: normalizedMatch }, "Set TTS pronunciation");
        res.json({ success: true, message: "Pronunciation saved", match: normalizedMatch, say: normalizedSay.value });
    } catch (error) {
        logger.error({ error, channelName, match }, "Error setting TTS pronunciation");
        apiError(res, 500, "pronunciation_save_failed", "Failed to save pronunciation");
    }
}) as RequestHandler);

// DELETE /tts/pronunciations/channel/:channelName - Remove an entry
router.delete("/tts/pronunciations/channel/:channelName", authenticateApiRequest, authorizeChannelAccess, (async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const { channelName } = req.params;
    const { match } = req.body;

    const normalizedMatch = normalizeMatchKey(match);
    if (!normalizedMatch) {
        apiError(res, 400, "word_required", "Word is required");
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
        apiError(res, 500, "pronunciation_remove_failed", "Failed to remove pronunciation");
    }
}) as RequestHandler);

export default router;
