"use strict";
/**
 * Bot management API routes
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const firestore_1 = require("../services/firestore");
const twitch_1 = require("../services/twitch");
const utils_1 = require("../services/utils");
const auth_1 = require("../middleware/auth");
const config_1 = require("../config");
const logger_1 = require("../logger");
const router = express_1.default.Router();
// Route: /api/bot/status
router.get("/status", auth_1.authenticateApiRequest, async (req, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "Unauthorized" });
        return;
    }
    const channelLogin = req.user.userLogin;
    const log = logger_1.logger.child({ endpoint: "/api/bot/status", channelLogin });
    if (!firestore_1.db) {
        log.error("Firestore (db) not initialized!");
        res.status(500).json({ success: false, message: "Firestore not available." });
        return;
    }
    try {
        // Ensure we have a valid Twitch token for this user
        try {
            await (0, twitch_1.getValidTwitchTokenForUser)(channelLogin, config_1.secrets);
            // Token is valid - proceed
        }
        catch (tokenError) {
            // Token refresh failed, but we can still check bot status
            const err = tokenError;
            log.warn({ error: err.message }, "Token validation failed, but continuing");
        }
        const docRef = firestore_1.db.collection(firestore_1.COLLECTIONS.MANAGED_CHANNELS).doc(channelLogin);
        const docSnap = await docRef.get();
        const data = docSnap.data();
        if (docSnap.exists && data?.isActive) {
            res.json({
                success: true,
                isActive: true,
                channelName: data.channelName || channelLogin,
                needsReAuth: data.needsTwitchReAuth === true,
                oauthTier: data.oauthTier || 'full', // Default to 'full' for backward compatibility
            });
        }
        else {
            res.json({
                success: true,
                isActive: false,
                channelName: channelLogin,
                needsReAuth: docSnap.exists && data?.needsTwitchReAuth === true,
                oauthTier: docSnap.exists && data ? (data.oauthTier || 'full') : 'full',
            });
        }
    }
    catch (error) {
        const err = error;
        log.error({ error: err.message }, "Error getting status");
        res.status(500).json({ success: false, message: "Error fetching bot status." });
    }
});
// Route: /api/bot/add
router.post("/add", auth_1.authenticateApiRequest, async (req, res) => {
    // Ensure secrets are loaded before accessing config
    await config_1.secretsLoadedPromise;
    if (!req.user) {
        res.status(401).json({ success: false, message: "Unauthorized" });
        return;
    }
    const { userId: twitchUserId, userLogin: channelLogin, displayName } = req.user;
    const log = logger_1.logger.child({ endpoint: "/api/bot/add", channelLogin, twitchUserId });
    if (!firestore_1.db) {
        log.error("Firestore (db) not initialized!");
        res.status(500).json({ success: false, message: "Firestore not available." });
        return;
    }
    // Enforce allow-list FIRST (check BEFORE token validation to return accurate errors)
    try {
        const allowedList = await (0, utils_1.getAllowedChannelsList)();
        if (allowedList !== null && !allowedList.includes(channelLogin.toLowerCase())) {
            log.warn("Channel not in allow-list. Access denied.");
            res.status(403).json({
                success: false,
                message: "Your channel is not authorized to use this bot. Please contact support if you believe this is an error.",
            });
            return;
        }
    }
    catch (allowListError) {
        const err = allowListError;
        log.error({ error: err.message }, "Error checking allow-list");
        res.status(500).json({
            success: false,
            message: "Server error while checking channel authorization.",
        });
        return;
    }
    try {
        // Ensure we have a valid Twitch token for this user
        await (0, twitch_1.getValidTwitchTokenForUser)(channelLogin, config_1.secrets);
        log.info("Adding bot to channel");
        const docRef = firestore_1.db.collection(firestore_1.COLLECTIONS.MANAGED_CHANNELS).doc(channelLogin);
        await docRef.set({
            isActive: true,
            twitchUserId,
            twitchUserLogin: channelLogin,
            twitchDisplayName: displayName,
            channelName: channelLogin,
            addedAt: new Date(),
        }, { merge: true });
        log.info("Bot successfully added to channel");
        // Automatically add bot as moderator
        let modStatus = { success: false, error: "Bot username not configured" };
        if (config_1.config.TWITCH_BOT_USERNAME) {
            try {
                log.debug({ botUsername: config_1.config.TWITCH_BOT_USERNAME }, "Attempting to add bot as moderator");
                const botUserId = await (0, twitch_1.getUserIdFromUsername)(config_1.config.TWITCH_BOT_USERNAME, config_1.secrets);
                if (botUserId) {
                    modStatus = await (0, twitch_1.addModerator)(channelLogin, twitchUserId, botUserId, config_1.secrets);
                    if (modStatus.success) {
                        log.info("Bot successfully added as moderator");
                    }
                    else {
                        log.warn({ error: modStatus.error }, "Failed to add bot as moderator");
                    }
                }
                else {
                    log.warn({ botUsername: config_1.config.TWITCH_BOT_USERNAME }, "Could not find user ID for bot username");
                    modStatus = { success: false, error: "Bot user not found" };
                }
            }
            catch (modError) {
                const err = modError;
                log.error({ error: err.message }, "Error adding bot as moderator");
                modStatus = { success: false, error: err.message };
            }
        }
        else {
            log.warn("TWITCH_BOT_USERNAME not configured, skipping moderator setup");
        }
        res.json({
            success: true,
            message: "Bot added to your channel successfully!",
            channelName: channelLogin,
            moderatorStatus: modStatus.success ? "added" : "failed",
            moderatorError: modStatus.success ? undefined : modStatus.error,
        });
    }
    catch (error) {
        const err = error;
        log.error({ error: err.message }, "Error adding bot");
        if (err.message.includes("re-authenticate")) {
            res.status(401).json({
                success: false,
                message: "Please re-authenticate with Twitch to add the bot.",
                needsReauth: true,
            });
        }
        else {
            res.status(500).json({
                success: false,
                message: "Failed to add bot to your channel. Please try again.",
            });
        }
    }
});
// Route: /api/bot/remove
router.post("/remove", auth_1.authenticateApiRequest, async (req, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "Unauthorized" });
        return;
    }
    const { userId: twitchUserId, userLogin: channelLogin } = req.user;
    const log = logger_1.logger.child({ endpoint: "/api/bot/remove", channelLogin, twitchUserId });
    if (!firestore_1.db) {
        log.error("Firestore (db) not initialized!");
        res.status(500).json({ success: false, message: "Firestore not available." });
        return;
    }
    try {
        log.info("Removing bot from channel");
        const docRef = firestore_1.db.collection(firestore_1.COLLECTIONS.MANAGED_CHANNELS).doc(channelLogin);
        await docRef.update({
            isActive: false,
            removedAt: new Date(),
        });
        log.info("Bot successfully removed from channel");
        res.json({
            success: true,
            message: "Bot removed from your channel successfully!",
            channelName: channelLogin,
        });
    }
    catch (error) {
        const err = error;
        log.error({ error: err.message }, "Error removing bot");
        res.status(500).json({
            success: false,
            message: "Failed to remove bot from your channel. Please try again.",
        });
    }
});
exports.default = router;
//# sourceMappingURL=bot.js.map