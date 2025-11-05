"use strict";
/**
 * OBS integration API routes
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const crypto_1 = require("crypto");
const firestore_1 = require("../services/firestore");
const twitch_1 = require("../services/twitch");
const auth_1 = require("../middleware/auth");
const config_1 = require("../config");
const logger_1 = require("../logger");
const router = express_1.default.Router();
// Route: /api/obs/getToken
router.get("/getToken", auth_1.authenticateApiRequest, async (req, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "Unauthorized" });
        return;
    }
    const channelLogin = req.user.userLogin;
    const log = logger_1.logger.child({ endpoint: "/api/obs/getToken", channelLogin });
    log.info("OBS token retrieval requested");
    if (!firestore_1.db || !config_1.secretManagerClient) {
        log.error("Firestore or Secret Manager client not initialized!");
        res.status(500).json({ success: false, message: "Server configuration error." });
        return;
    }
    try {
        // Check if user has valid Twitch tokens
        try {
            await (0, twitch_1.getValidTwitchTokenForUser)(channelLogin, config_1.secrets);
            log.debug("Verified valid Twitch token");
        }
        catch (tokenError) {
            const err = tokenError;
            log.error({ error: err.message }, "Token validation failed");
            res.status(403).json({
                success: false,
                needsReAuth: true,
                message: "Your Twitch authentication has expired. Please reconnect your account.",
            });
            return;
        }
        // Attempt to read secret reference from the TTS config (source of truth)
        const ttsDocRef = firestore_1.db.collection(firestore_1.COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelLogin);
        const ttsDoc = await ttsDocRef.get();
        const ttsData = ttsDoc.exists ? ttsDoc.data() : null;
        if (ttsDoc.exists && ttsData?.obsSocketSecretName) {
            try {
                const [version] = await config_1.secretManagerClient.accessSecretVersion({
                    name: ttsData.obsSocketSecretName,
                });
                const payloadData = version.payload?.data;
                if (!payloadData) {
                    throw new Error("Secret has no data");
                }
                const existingToken = payloadData.toString().trim();
                log.info("Retrieved existing OBS token (from ttsChannelConfigs)");
                res.json({
                    success: true,
                    token: existingToken,
                    browserSourceUrl: `${config_1.config.OBS_BROWSER_BASE_URL}/?channel=${encodeURIComponent(channelLogin)}&token=${existingToken}`,
                });
                return;
            }
            catch (secretError) {
                const err = secretError;
                log.warn({ error: err.message }, "Failed to retrieve existing token from ttsChannelConfigs");
                // Fall through to legacy check or generate new token
            }
        }
        // Legacy fallback: check managedChannels for obsTokenSecretName
        const userDocRef = firestore_1.db.collection(firestore_1.COLLECTIONS.MANAGED_CHANNELS).doc(channelLogin);
        const userDoc = await userDocRef.get();
        const userData = userDoc.exists ? userDoc.data() : null;
        if (userDoc.exists && userData?.obsTokenSecretName) {
            try {
                const [version] = await config_1.secretManagerClient.accessSecretVersion({
                    name: userData.obsTokenSecretName,
                });
                const payloadData = version.payload?.data;
                if (!payloadData) {
                    throw new Error("Secret has no data");
                }
                const existingToken = payloadData.toString().trim();
                log.info("Retrieved existing OBS token (from managedChannels)");
                res.json({
                    success: true,
                    token: existingToken,
                    browserSourceUrl: `${config_1.config.OBS_BROWSER_BASE_URL}/?channel=${encodeURIComponent(channelLogin)}&token=${existingToken}`,
                });
                return;
            }
            catch (secretError) {
                const err = secretError;
                log.warn({ error: err.message }, "Failed legacy retrieval from managedChannels");
                // Continue to generate new token
            }
        }
        // Generate new OBS token
        const obsToken = (0, crypto_1.randomBytes)(32).toString("hex");
        const secretName = `projects/${config_1.config.GCLOUD_PROJECT}/secrets/obs-token-${channelLogin}`;
        try {
            // Create secret if it doesn't exist
            try {
                await config_1.secretManagerClient.createSecret({
                    parent: `projects/${config_1.config.GCLOUD_PROJECT}`,
                    secretId: `obs-token-${channelLogin}`,
                    secret: {
                        replication: { automatic: {} },
                    },
                });
            }
            catch (createError) {
                const err = createError;
                if (!err.message.includes("already exists")) {
                    throw createError;
                }
            }
            // Add secret version
            await config_1.secretManagerClient.addSecretVersion({
                parent: secretName,
                payload: {
                    data: Buffer.from(obsToken),
                },
            });
            // Update user document with secret reference
            await userDocRef.update({
                obsTokenSecretName: `${secretName}/versions/latest`,
                obsTokenGeneratedAt: new Date(),
            });
            log.info("Generated new OBS token");
            res.json({
                success: true,
                token: obsToken,
                browserSourceUrl: `${config_1.config.OBS_BROWSER_BASE_URL}/?channel=${encodeURIComponent(channelLogin)}&token=${obsToken}`,
            });
        }
        catch (error) {
            const err = error;
            log.error({ error: err.message }, "Failed to store OBS token");
            res.status(500).json({
                success: false,
                message: "Failed to generate OBS token. Please try again.",
            });
        }
    }
    catch (error) {
        const err = error;
        log.error({ error: err.message }, "Error retrieving OBS token");
        res.status(500).json({
            success: false,
            message: "Failed to retrieve OBS token.",
        });
    }
});
// Route: /api/obs/generateToken
router.post("/generateToken", auth_1.authenticateApiRequest, async (req, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: "Unauthorized" });
        return;
    }
    const channelLogin = req.user.userLogin;
    const log = logger_1.logger.child({ endpoint: "/api/obs/generateToken", channelLogin });
    log.info("OBS token generation requested");
    if (!firestore_1.db || !config_1.secretManagerClient) {
        log.error("Firestore or Secret Manager client not initialized!");
        res.status(500).json({ success: false, message: "Server configuration error." });
        return;
    }
    try {
        // Verify valid Twitch token
        try {
            await (0, twitch_1.getValidTwitchTokenForUser)(channelLogin, config_1.secrets);
        }
        catch (tokenError) {
            res.status(403).json({
                success: false,
                needsReAuth: true,
                message: "Your Twitch authentication has expired. Please reconnect your account.",
            });
            return;
        }
        // Generate new OBS token
        const obsToken = (0, crypto_1.randomBytes)(32).toString("hex");
        const secretName = `projects/${config_1.config.GCLOUD_PROJECT}/secrets/obs-token-${channelLogin}`;
        // Create or update secret
        try {
            await config_1.secretManagerClient.createSecret({
                parent: `projects/${config_1.config.GCLOUD_PROJECT}`,
                secretId: `obs-token-${channelLogin}`,
                secret: {
                    replication: { automatic: {} },
                },
            });
        }
        catch (createError) {
            const err = createError;
            if (!err.message.includes("already exists")) {
                throw createError;
            }
        }
        await config_1.secretManagerClient.addSecretVersion({
            parent: secretName,
            payload: {
                data: Buffer.from(obsToken),
            },
        });
        // Store the secret name in the TTS channel config (source of truth)
        const fullSecretName = `${secretName}/versions/latest`;
        const ttsDocRef2 = firestore_1.db.collection(firestore_1.COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelLogin);
        await ttsDocRef2.set({
            obsSocketSecretName: fullSecretName,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        }, { merge: true });
        // Optionally update the managedChannels document for auditing
        const userDocRef2 = firestore_1.db.collection(firestore_1.COLLECTIONS.MANAGED_CHANNELS).doc(channelLogin);
        await userDocRef2.set({
            obsTokenGeneratedAt: new Date(),
        }, { merge: true });
        log.info("Generated new OBS token");
        res.json({
            success: true,
            token: obsToken,
            browserSourceUrl: `${config_1.config.OBS_BROWSER_BASE_URL}/?channel=${encodeURIComponent(channelLogin)}&token=${obsToken}`,
            message: "New OBS token generated successfully",
        });
    }
    catch (error) {
        const err = error;
        log.error({ error: err.message }, "Error generating OBS token");
        res.status(500).json({
            success: false,
            message: "Failed to generate new OBS token.",
        });
    }
});
exports.default = router;
//# sourceMappingURL=obs.js.map