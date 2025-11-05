"use strict";
/**
 * Miscellaneous API routes (shortlinks, TTS test, etc.)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redirectRouter = exports.apiRouter = void 0;
const express_1 = __importDefault(require("express"));
const axios_1 = __importDefault(require("axios"));
const firestore_1 = require("../services/firestore");
const utils_1 = require("../services/utils");
const auth_1 = require("../middleware/auth");
const config_1 = require("../config");
const logger_1 = require("../logger");
// Separate routers for API endpoints and public redirects
const apiRouter = express_1.default.Router();
exports.apiRouter = apiRouter;
const redirectRouter = express_1.default.Router();
exports.redirectRouter = redirectRouter;
// Route: /api/shortlink - Create a short link (requires app/viewer JWT)
apiRouter.post("/shortlink", auth_1.authenticateApiRequest, async (req, res) => {
    const log = logger_1.logger.child({ endpoint: "/api/shortlink" });
    try {
        const { url } = req.body;
        if (!url) {
            res.status(400).json({ error: "URL is required" });
            return;
        }
        const slug = await (0, utils_1.createShortLink)(url);
        const pathOnly = `/s/${slug}`;
        const absoluteUrl = config_1.config.FRONTEND_URL ? `${new URL(config_1.config.FRONTEND_URL).origin}${pathOnly}` : pathOnly;
        res.json({
            success: true,
            slug: slug,
            shortUrl: pathOnly,
            absoluteUrl: absoluteUrl,
        });
    }
    catch (error) {
        const err = error;
        log.error({ error: err.message }, "Error creating shortlink");
        res.status(500).json({
            success: false,
            error: err.message,
        });
    }
});
// Route: /s/:slug - Redirect short link (public)
redirectRouter.get("/s/:slug", async (req, res) => {
    const { slug } = req.params;
    try {
        if (!slug) {
            res.status(400).send("Invalid short link");
            return;
        }
        const shortlinkDoc = await firestore_1.db.collection(firestore_1.COLLECTIONS.SHORTLINKS).doc(slug).get();
        if (!shortlinkDoc.exists) {
            res.status(404).send("Short link not found");
            return;
        }
        const data = shortlinkDoc.data();
        const { url } = data;
        // Increment click counter
        try {
            await shortlinkDoc.ref.update({
                clicks: (data.clicks || 0) + 1,
                lastClickedAt: new Date(),
            });
        }
        catch (updateError) {
            const err = updateError;
            logger_1.logger.warn({ error: err.message, slug }, "Failed to update click counter");
        }
        logger_1.logger.info({ slug, url }, "Redirecting short link");
        res.redirect(301, url);
    }
    catch (error) {
        const err = error;
        logger_1.logger.error({ error: err.message, slug }, "Error redirecting short link");
        res.status(500).send("Internal server error");
    }
});
// Route: /api/tts/test - Test TTS functionality
apiRouter.post("/tts/test", auth_1.authenticateApiRequest, async (req, res) => {
    if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }
    const { text, voiceId, emotion, pitch, speed, languageBoost, channel } = req.body || {};
    const channelLogin = req.user.userLogin;
    const log = logger_1.logger.child({ endpoint: "/api/tts/test", channelLogin, voiceId: voiceId || "default" });
    try {
        if (!text) {
            res.status(400).json({
                success: false,
                error: "Text is required for TTS test",
            });
            return;
        }
        log.info({ textLength: text.length }, "TTS test requested");
        // Resolve effective parameters in order: request override -> viewer global prefs -> channel defaults
        let effective = { voiceId: voiceId ?? null, emotion: (0, utils_1.normalizeEmotion)(emotion), pitch: (pitch !== undefined) ? pitch : null, speed: (speed !== undefined) ? speed : null, languageBoost: languageBoost ?? null };
        try {
            // Load viewer global preferences
            const userDoc = await firestore_1.db.collection("ttsUserPreferences").doc(channelLogin).get();
            const userPrefs = userDoc.exists ? (userDoc.data() || {}) : {};
            // Optionally load channel defaults if a channel is provided
            let channelDefaults = {};
            if (channel) {
                const channelDoc = await firestore_1.db.collection(firestore_1.COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channel).get();
                if (channelDoc.exists) {
                    const d = channelDoc.data() || {};
                    channelDefaults = {
                        voiceId: d.voiceId ?? null,
                        emotion: d.emotion ?? null,
                        pitch: (d.pitch !== undefined) ? d.pitch : null,
                        speed: (d.speed !== undefined) ? d.speed : null,
                        languageBoost: d.languageBoost ?? null,
                    };
                }
            }
            const pick = (reqVal, userVal, chanVal) => {
                if (reqVal !== undefined && reqVal !== null && reqVal !== "")
                    return reqVal; // explicit request
                if (userVal !== undefined && userVal !== null && userVal !== "")
                    return userVal; // viewer global
                return (chanVal !== undefined && chanVal !== null && chanVal !== "") ? chanVal : null; // channel default
            };
            effective = {
                voiceId: pick(voiceId, userPrefs.voiceId, channelDefaults.voiceId),
                emotion: (0, utils_1.normalizeEmotion)(pick(emotion, userPrefs.emotion, channelDefaults.emotion)),
                pitch: pick(pitch, userPrefs.pitch, channelDefaults.pitch),
                speed: pick(speed, userPrefs.speed, channelDefaults.speed),
                languageBoost: pick(languageBoost, userPrefs.languageBoost, channelDefaults.languageBoost),
            };
            log.debug({ effective }, "Effective params");
        }
        catch (resolveErr) {
            const err = resolveErr;
            log.warn({ error: err.message }, "Failed to resolve defaults; proceeding with request values only");
        }
        // If configured, generate audio via Wavespeed AI (minimax/speech-02-turbo)
        if (config_1.secrets.WAVESPEED_API_KEY) {
            try {
                log.debug("Wavespeed AI client initialized for TTS test");
                // Map legacy language boost values to Wavespeed format
                let languageBoostValue = effective.languageBoost || "auto";
                if (languageBoostValue === "Automatic" || languageBoostValue === "None") {
                    languageBoostValue = "auto";
                }
                const input = {
                    text,
                    voice_id: effective.voiceId || "Friendly_Person",
                    speed: typeof effective.speed === "number" ? effective.speed : 1.0,
                    volume: 1.0,
                    pitch: typeof effective.pitch === "number" ? effective.pitch : 0,
                    emotion: effective.emotion || "neutral",
                    language_boost: languageBoostValue,
                    english_normalization: false,
                    sample_rate: 32000,
                    bitrate: 128000,
                    channel: "1",
                    format: "mp3",
                    enable_sync_mode: true, // Enable sync mode for lowest latency
                };
                const response = await axios_1.default.post("https://api.wavespeed.ai/api/v3/minimax/speech-02-turbo", input, {
                    headers: {
                        "Authorization": `Bearer ${config_1.secrets.WAVESPEED_API_KEY}`,
                        "Content-Type": "application/json",
                    },
                    timeout: 60000, // 60 second timeout
                });
                const result = response.data;
                const data = result.data || result;
                if (data.status === "completed" && data.outputs && data.outputs.length > 0) {
                    const audioUrl = data.outputs[0];
                    res.json({ success: true, audioUrl, provider: "wavespeed", model: "minimax/speech-02-turbo" });
                    return;
                }
                else if (data.status === "failed") {
                    log.error({ error: data.error }, "Wavespeed AI returned failed status");
                    // Provide specific error messages based on the failure reason
                    if (data.error && data.error.includes("you don't have access to this voice_id")) {
                        res.status(403).json({
                            success: false,
                            error: `Voice access denied: The voice "${effective.voiceId}" requires special access permissions. Please try a different voice.`,
                        });
                        return;
                    }
                    if (data.error && data.error.includes("voice_id")) {
                        res.status(400).json({
                            success: false,
                            error: `Invalid voice: "${effective.voiceId}" is not available. Please check the voice ID and try again.`,
                        });
                        return;
                    }
                    res.status(502).json({ success: false, error: `TTS generation failed: ${data.error || "Unknown error"}` });
                    return;
                }
                else {
                    log.warn({ data: (0, logger_1.redactSensitive)(data) }, "Wavespeed AI returned unexpected status or missing outputs");
                    res.status(502).json({ success: false, error: "No audio URL returned by TTS provider" });
                    return;
                }
            }
            catch (wavespeedError) {
                const err = wavespeedError;
                log.error({
                    error: err.message,
                    responseData: (0, logger_1.redactSensitive)(err?.response?.data),
                }, "Wavespeed AI call failed");
                // Provide specific error messages based on Wavespeed API response
                if (err.response?.data) {
                    const apiError = err.response.data;
                    // Check for specific Wavespeed error messages
                    if (apiError.message && apiError.message.includes("you don't have access to this voice_id")) {
                        res.status(403).json({
                            success: false,
                            error: `Voice access denied: The voice "${effective.voiceId}" requires special access permissions. Please try a different voice.`,
                        });
                        return;
                    }
                    if (apiError.message && apiError.message.includes("voice_id")) {
                        res.status(400).json({
                            success: false,
                            error: `Invalid voice: "${effective.voiceId}" is not available. Please check the voice ID and try again.`,
                        });
                        return;
                    }
                    if (apiError.message) {
                        res.status(502).json({
                            success: false,
                            error: `TTS generation failed: ${apiError.message}`,
                        });
                        return;
                    }
                }
                // Fallback to generic error
                res.status(500).json({ success: false, error: "TTS generation failed" });
                return;
            }
        }
        // Fallback when Wavespeed AI is not configured
        res.status(501).json({ success: false, error: "TTS provider not configured" });
    }
    catch (error) {
        const err = error;
        log.error({ error: err.message }, "Error in TTS test");
        res.status(500).json({
            success: false,
            error: "TTS test failed",
            message: err.message,
        });
    }
});
//# sourceMappingURL=misc.js.map