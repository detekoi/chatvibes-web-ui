"use strict";
/**
 * Authentication API routes for status and token management
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const firestore_1 = require("../services/firestore");
const twitch_1 = require("../services/twitch");
const auth_1 = require("../middleware/auth");
const config_1 = require("../config");
const logger_1 = require("../logger");
const router = express_1.default.Router();
// Route: /api/auth/status
router.get("/status", auth_1.authenticateApiRequest, async (req, res) => {
    const log = logger_1.logger.child({ endpoint: "/api/auth/status", userLogin: req.user?.userLogin });
    log.info("--- /api/auth/status HIT ---");
    log.debug({ user: req.user }, "Authenticated user from middleware");
    try {
        if (!req.user) {
            res.status(401).json({ success: false, error: "Unauthorized" });
            return;
        }
        const userDocRef = firestore_1.db.collection(firestore_1.COLLECTIONS.MANAGED_CHANNELS).doc(req.user.userLogin);
        const userDoc = await userDocRef.get();
        if (!userDoc.exists) {
            log.warn({ userLogin: req.user.userLogin }, "User not found in managed channels");
            res.json({
                success: true,
                user: req.user,
                twitchTokenStatus: "not_found",
                needsTwitchReAuth: true,
            });
            return;
        }
        const userData = userDoc.data();
        if (!userData) {
            res.status(500).json({ success: false, error: "User data not found" });
            return;
        }
        const { needsTwitchReAuth, twitchAccessTokenExpiresAt } = userData;
        let twitchTokenStatus = "valid";
        if (needsTwitchReAuth) {
            twitchTokenStatus = "needs_reauth";
        }
        else if (twitchAccessTokenExpiresAt) {
            const expiresAt = twitchAccessTokenExpiresAt.toDate();
            const now = new Date();
            if (expiresAt <= now) {
                twitchTokenStatus = "expired";
            }
        }
        log.info({ userLogin: req.user.userLogin, twitchTokenStatus }, "User auth status");
        res.json({
            success: true,
            user: req.user,
            twitchTokenStatus: twitchTokenStatus,
            needsTwitchReAuth: needsTwitchReAuth || false,
        });
    }
    catch (error) {
        const err = error;
        logger_1.logger.error({ error: err.message }, "Error checking auth status");
        res.status(500).json({
            success: false,
            error: "Failed to check authentication status",
        });
    }
});
// Route: /api/auth/refresh
router.post("/refresh", auth_1.authenticateApiRequest, async (req, res) => {
    const log = logger_1.logger.child({ endpoint: "/api/auth/refresh", userLogin: req.user?.userLogin });
    log.info("--- /api/auth/refresh HIT ---");
    try {
        if (!req.user) {
            res.status(401).json({ success: false, error: "Unauthorized" });
            return;
        }
        // This will automatically refresh the token if needed
        await (0, twitch_1.getValidTwitchTokenForUser)(req.user.userLogin, config_1.secrets);
        log.info("Token refresh successful");
        res.json({
            success: true,
            message: "Token refreshed successfully",
        });
    }
    catch (error) {
        const err = error;
        log.error({ error: err.message }, "Token refresh failed");
        res.status(400).json({
            success: false,
            error: err.message,
            needsReauth: err.message.includes("re-authenticate"),
        });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map