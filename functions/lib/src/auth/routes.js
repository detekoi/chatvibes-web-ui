"use strict";
/**
 * Authentication routes for Twitch OAuth
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const crypto_1 = require("crypto");
const axios_1 = __importDefault(require("axios"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config");
const firestore_1 = require("../services/firestore");
const twitch_1 = require("../services/twitch");
const logger_1 = require("../logger");
const router = express_1.default.Router();
// Twitch API endpoints
const TWITCH_AUTH_URL = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
/**
 * Helper function to redirect to frontend with error
 * @param res - Express response object
 * @param errorCode - Error code
 * @param errorDescription - Error description
 * @param state - OAuth state parameter
 * @return Express redirect response
 */
function redirectToFrontendWithError(res, errorCode, errorDescription, state) {
    if (!config_1.config.FRONTEND_URL) {
        logger_1.logger.error("FRONTEND_URL not configured");
        res.status(500).send("Server configuration error");
        return;
    }
    const frontendErrorUrl = new URL(config_1.config.FRONTEND_URL);
    frontendErrorUrl.pathname = "/auth-error.html";
    frontendErrorUrl.searchParams.append("error", errorCode);
    frontendErrorUrl.searchParams.append("error_description", errorDescription);
    if (state)
        frontendErrorUrl.searchParams.append("state", state);
    logger_1.logger.info({ errorCode, errorDescription }, "Redirecting to frontend error page");
    res.redirect(frontendErrorUrl.toString());
}
/**
 * Helper function to handle viewer OAuth callback
 * @param req - Express request object
 * @param res - Express response object
 * @param decodedState - Decoded OAuth state
 * @return JSON response
 */
async function handleViewerCallback(req, res, decodedState) {
    logger_1.logger.info("Handling viewer OAuth callback");
    const { code, error: twitchError, error_description: twitchErrorDescription } = req.query;
    if (twitchError) {
        logger_1.logger.error({ twitchError, twitchErrorDescription }, "Viewer OAuth error");
        return res.status(400).json({
            success: false,
            error: twitchError,
            error_description: twitchErrorDescription,
        });
    }
    try {
        // Exchange code for token
        const tokenResponse = await axios_1.default.post(TWITCH_TOKEN_URL, null, {
            params: {
                client_id: config_1.secrets.TWITCH_CLIENT_ID,
                client_secret: config_1.secrets.TWITCH_CLIENT_SECRET,
                code: code,
                grant_type: "authorization_code",
                redirect_uri: config_1.config.CALLBACK_URL,
            },
        });
        const { access_token: accessToken } = tokenResponse.data;
        if (!accessToken) {
            throw new Error("No access token received from Twitch");
        }
        // Validate token and get user info
        const userInfo = await (0, twitch_1.validateTwitchToken)(accessToken);
        const userLogin = userInfo.login.toLowerCase();
        // Create JWT token for the viewer
        const viewerTokenPayload = {
            userId: userInfo.user_id,
            userLogin: userLogin,
            displayName: userInfo.login,
            scope: "viewer",
        };
        const viewerSessionToken = jsonwebtoken_1.default.sign(viewerTokenPayload, config_1.secrets.JWT_SECRET, {
            expiresIn: "7d",
            issuer: "chatvibes-auth",
            audience: "chatvibes-api",
        });
        logger_1.logger.info({ userLogin }, "Generated viewer session token");
        if (!config_1.config.FRONTEND_URL) {
            throw new Error("FRONTEND_URL not configured");
        }
        // Redirect viewers back to the preferences page with a validated session token
        const redirectUrl = new URL(config_1.config.FRONTEND_URL);
        redirectUrl.pathname = "/viewer-settings.html";
        redirectUrl.searchParams.set("session_token", viewerSessionToken);
        redirectUrl.searchParams.set("validated", "1");
        // Preserve optional channel context if present in state
        if (decodedState && (decodedState.c || decodedState.channel)) {
            const channel = decodedState.c || decodedState.channel;
            if (channel) {
                redirectUrl.searchParams.set("channel", channel);
            }
        }
        res.redirect(redirectUrl.toString());
        return res;
    }
    catch (error) {
        const err = error;
        logger_1.logger.error({ error: err.message }, "Viewer OAuth callback error");
        return res.status(500).json({
            success: false,
            error: "auth_failed",
            error_description: "Failed to complete viewer authentication",
        });
    }
}
// Route: /auth/twitch/initiate
router.get("/twitch/initiate", (_req, res) => {
    logger_1.logger.info("--- /auth/twitch/initiate HIT --- Version 1.2 ---");
    if (!config_1.secrets.TWITCH_CLIENT_ID || !config_1.config.CALLBACK_URL) {
        logger_1.logger.error("Config missing for /auth/twitch/initiate: TWITCH_CLIENT_ID or CALLBACK_URL not found.");
        res.status(500).json({ success: false, error: "Server configuration error for Twitch auth." });
        return;
    }
    const state = (0, crypto_1.randomBytes)(16).toString("hex");
    const params = new URLSearchParams({
        client_id: config_1.secrets.TWITCH_CLIENT_ID,
        redirect_uri: config_1.config.CALLBACK_URL,
        response_type: "code",
        scope: "user:read:email chat:read chat:edit channel:read:subscriptions bits:read moderator:read:followers channel:manage:redemptions channel:read:redemptions channel:manage:moderators",
        state: state,
        force_verify: "true",
    });
    const twitchAuthUrl = `${TWITCH_AUTH_URL}?${params.toString()}`;
    logger_1.logger.info({ state }, "Generated state");
    logger_1.logger.debug({ twitchAuthUrl }, "Twitch Auth URL to be sent to frontend");
    res.json({
        success: true,
        twitchAuthUrl: twitchAuthUrl,
        state: state,
    });
});
// Route: /auth/twitch/callback
router.get("/twitch/callback", async (req, res) => {
    logger_1.logger.info("--- /auth/twitch/callback HIT ---");
    logger_1.logger.debug({ query: (0, logger_1.redactSensitive)(req.query) }, "Callback Request Query Params");
    const { code, state: twitchQueryState, error: twitchError, error_description: twitchErrorDescription } = req.query;
    // Try to decode state parameter to detect viewer auth
    let isViewerAuth = false;
    let decodedState = null;
    try {
        if (typeof twitchQueryState === "string") {
            decodedState = JSON.parse(Buffer.from(twitchQueryState, "base64").toString());
            if (decodedState && decodedState.t === "viewer") {
                isViewerAuth = true;
                logger_1.logger.info("Detected viewer auth from state parameter");
            }
        }
    }
    catch (error) {
        logger_1.logger.debug("State is not viewer JSON format, treating as regular auth");
    }
    if (isViewerAuth) {
        logger_1.logger.info("Detected viewer OAuth callback, delegating to viewer handler");
        return handleViewerCallback(req, res, decodedState);
    }
    if (twitchError) {
        logger_1.logger.error({ twitchError, twitchErrorDescription }, "Twitch OAuth explicit error");
        return redirectToFrontendWithError(res, twitchError, twitchErrorDescription, twitchQueryState);
    }
    try {
        logger_1.logger.debug({ callbackUrl: config_1.config.CALLBACK_URL }, "Exchanging code for token");
        const tokenResponse = await axios_1.default.post(TWITCH_TOKEN_URL, null, {
            params: {
                client_id: config_1.secrets.TWITCH_CLIENT_ID,
                client_secret: config_1.secrets.TWITCH_CLIENT_SECRET,
                code: code,
                grant_type: "authorization_code",
                redirect_uri: config_1.config.CALLBACK_URL,
            },
        });
        const { access_token: accessToken, refresh_token: refreshToken } = tokenResponse.data;
        logger_1.logger.info("Access token and refresh token received from Twitch.");
        if (!accessToken || !refreshToken) {
            logger_1.logger.error({ responseData: (0, logger_1.redactSensitive)(tokenResponse.data) }, "Missing access_token or refresh_token from Twitch");
            throw new Error("Twitch did not return the expected tokens.");
        }
        const validateResponse = await axios_1.default.get(TWITCH_VALIDATE_URL, {
            headers: { Authorization: `OAuth ${accessToken}` },
        });
        if (validateResponse.data && validateResponse.data.user_id) {
            // Fetch user details including email
            const userResponse = await axios_1.default.get("https://api.twitch.tv/helix/users", {
                headers: {
                    "Authorization": `Bearer ${accessToken}`,
                    "Client-Id": config_1.secrets.TWITCH_CLIENT_ID,
                },
            });
            const userData = userResponse.data.data[0];
            const twitchUser = {
                id: validateResponse.data.user_id,
                login: validateResponse.data.login.toLowerCase(),
                displayName: userData?.display_name || validateResponse.data.login,
                email: userData?.email || null,
            };
            logger_1.logger.info({ userLogin: twitchUser.login }, "[AuthCallback] User authenticated and validated");
            if (!config_1.secrets.JWT_SECRET) {
                logger_1.logger.error("JWT_SECRET is not configured.");
                return res.status(500).send("Server configuration error (JWT signing).");
            }
            const appTokenPayload = {
                userId: twitchUser.id,
                userLogin: twitchUser.login,
                displayName: twitchUser.displayName,
            };
            const appSessionToken = jsonwebtoken_1.default.sign(appTokenPayload, config_1.secrets.JWT_SECRET, {
                expiresIn: "7d",
                issuer: "chatvibes-auth",
                audience: "chatvibes-api",
            });
            logger_1.logger.info({ userLogin: twitchUser.login }, "Generated app session token");
            if (!config_1.config.FRONTEND_URL) {
                throw new Error("FRONTEND_URL not configured");
            }
            const frontendAuthCompleteUrl = new URL(config_1.config.FRONTEND_URL);
            frontendAuthCompleteUrl.pathname = "/auth-complete.html";
            frontendAuthCompleteUrl.searchParams.append("user_login", twitchUser.login);
            frontendAuthCompleteUrl.searchParams.append("user_id", twitchUser.id);
            frontendAuthCompleteUrl.searchParams.append("state", twitchQueryState);
            frontendAuthCompleteUrl.searchParams.append("session_token", appSessionToken);
            logger_1.logger.info({ userLogin: twitchUser.login }, "Redirecting to frontend auth-complete page");
            // Store tokens securely
            if (firestore_1.db && config_1.secretManagerClient) {
                const userDocRef = firestore_1.db.collection(firestore_1.COLLECTIONS.MANAGED_CHANNELS).doc(twitchUser.login);
                const secretName = `projects/${config_1.config.GCLOUD_PROJECT}/secrets/twitch-refresh-token-${twitchUser.id}`;
                try {
                    // Store refresh token in Secret Manager
                    try {
                        await config_1.secretManagerClient.createSecret({
                            parent: `projects/${config_1.config.GCLOUD_PROJECT}`,
                            secretId: `twitch-refresh-token-${twitchUser.id}`,
                            secret: { replication: { automatic: {} } },
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
                        payload: { data: Buffer.from(refreshToken) },
                    });
                    // Store access token in Secret Manager
                    const accessSecretName = `projects/${config_1.config.GCLOUD_PROJECT}/secrets/twitch-access-token-${twitchUser.id}`;
                    try {
                        await config_1.secretManagerClient.createSecret({
                            parent: `projects/${config_1.config.GCLOUD_PROJECT}`,
                            secretId: `twitch-access-token-${twitchUser.id}`,
                            secret: { replication: { automatic: {} } },
                        });
                    }
                    catch (createError) {
                        const err = createError;
                        if (!err.message.includes("already exists")) {
                            throw createError;
                        }
                    }
                    await config_1.secretManagerClient.addSecretVersion({
                        parent: accessSecretName,
                        payload: { data: Buffer.from(accessToken) },
                    });
                    // Update user document in Firestore and ensure channelName exists for consistency with bot expectations
                    await userDocRef.set({
                        channelName: twitchUser.login,
                        twitchUserId: twitchUser.id,
                        twitchUserLogin: twitchUser.login,
                        twitchDisplayName: twitchUser.displayName,
                        email: twitchUser.email,
                        twitchAccessTokenExpiresAt: new Date(Date.now() + (validateResponse.data.expires_in * 1000)),
                        needsTwitchReAuth: false,
                        lastTokenError: null,
                        lastTokenErrorAt: null,
                    }, { merge: true });
                    logger_1.logger.info({ userLogin: twitchUser.login }, "Secret reference stored in Firestore");
                }
                catch (dbError) {
                    const err = dbError;
                    logger_1.logger.error({ userLogin: twitchUser.login, error: err.message }, "Error storing secret");
                    return redirectToFrontendWithError(res, "token_store_failed", "Failed to securely store Twitch credentials. Please try again.", twitchQueryState);
                }
            }
            else {
                logger_1.logger.error("Firestore (db) or SecretManagerServiceClient not initialized. Cannot store Twitch tokens.");
            }
            // Automatically setup EventSub subscriptions for the authenticated streamer
            try {
                logger_1.logger.info({ userLogin: twitchUser.login }, "[AuthCallback] Setting up EventSub");
                const ttsBotUrl = process.env.TTS_BOT_URL || "https://chatvibes-tts-service-906125386407.us-central1.run.app";
                const eventSubResponse = await fetch(`${ttsBotUrl}/api/setup-eventsub`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${appSessionToken}`,
                    },
                    body: JSON.stringify({
                        channelLogin: twitchUser.login,
                        userId: twitchUser.id,
                    }),
                });
                if (eventSubResponse.ok) {
                    const eventSubResult = await eventSubResponse.json();
                    logger_1.logger.info({ userLogin: twitchUser.login, result: eventSubResult }, "[AuthCallback] EventSub setup successful");
                }
                else {
                    const errorText = await eventSubResponse.text();
                    logger_1.logger.warn({ userLogin: twitchUser.login, status: eventSubResponse.status, error: errorText }, "[AuthCallback] EventSub setup failed");
                }
            }
            catch (eventSubError) {
                const err = eventSubError;
                logger_1.logger.error({ userLogin: twitchUser.login, error: err.message }, "[AuthCallback] Error setting up EventSub");
                // Don't fail the auth process if EventSub setup fails
            }
            return res.redirect(frontendAuthCompleteUrl.toString());
        }
        else {
            logger_1.logger.error("Failed to validate token or get user info from Twitch after token exchange.");
            throw new Error("Failed to validate token or get user info from Twitch.");
        }
    }
    catch (error) {
        const err = error;
        logger_1.logger.error({
            error: err.message,
            responseData: (0, logger_1.redactSensitive)(err.response?.data),
            stack: err.stack,
        }, "[AuthCallback] Twitch OAuth callback error");
        return redirectToFrontendWithError(res, "auth_failed", err.message || "Authentication failed with Twitch due to an internal server error.", twitchQueryState);
    }
});
// Route: /auth/twitch/viewer
router.get("/twitch/viewer", (req, res) => {
    logger_1.logger.info("--- /auth/twitch/viewer HIT ---");
    if (!config_1.secrets.TWITCH_CLIENT_ID || !config_1.config.CALLBACK_URL) {
        logger_1.logger.error("Config missing: TWITCH_CLIENT_ID or CALLBACK_URL not found.");
        res.status(500).json({ success: false, error: "Server configuration error for Twitch viewer auth." });
        return;
    }
    // Create state parameter with viewer type marker
    const { channel } = req.query || {};
    const statePayload = {
        t: "viewer", // type: viewer
        r: (0, crypto_1.randomBytes)(8).toString("hex"), // random component
        c: channel || undefined, // optional channel context
    };
    const state = Buffer.from(JSON.stringify(statePayload)).toString("base64");
    const params = new URLSearchParams({
        client_id: config_1.secrets.TWITCH_CLIENT_ID,
        redirect_uri: config_1.config.CALLBACK_URL,
        response_type: "code",
        scope: "",
        state: state,
        force_verify: "true",
    });
    const twitchAuthUrl = `${TWITCH_AUTH_URL}?${params.toString()}`;
    logger_1.logger.debug({ twitchAuthUrl }, "Generated viewer auth URL");
    res.json({
        success: true,
        twitchAuthUrl: twitchAuthUrl,
        state: state,
    });
});
// Route: /auth/logout
router.get("/logout", (_req, res) => {
    logger_1.logger.info("--- /auth/logout HIT ---");
    res.json({ success: true, message: "Logout successful. Please clear your session token on the client side." });
});
exports.default = router;
//# sourceMappingURL=routes.js.map