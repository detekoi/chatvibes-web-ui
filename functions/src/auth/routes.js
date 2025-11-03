/**
 * Authentication routes for Twitch OAuth
 */

const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const {secrets, config, secretManagerClient} = require("../config");
const {db, COLLECTIONS} = require("../services/firestore");
const {validateTwitchToken} = require("../services/twitch");
const {logger, redactSensitive} = require("../logger");

// eslint-disable-next-line new-cap
const router = express.Router();

// Twitch API endpoints
const TWITCH_AUTH_URL = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";

/**
 * Helper function to redirect to frontend with error
 * @param {Object} res - Express response object
 * @param {string} errorCode - Error code
 * @param {string} errorDescription - Error description
 * @param {string} state - OAuth state parameter
 * @return {Object} Express redirect response
 */
function redirectToFrontendWithError(res, errorCode, errorDescription, state) {
  const frontendErrorUrl = new URL(config.FRONTEND_URL);
  frontendErrorUrl.pathname = "/auth-error.html";
  frontendErrorUrl.searchParams.append("error", errorCode);
  frontendErrorUrl.searchParams.append("error_description", errorDescription);
  if (state) frontendErrorUrl.searchParams.append("state", state);

  logger.info({errorCode, errorDescription}, "Redirecting to frontend error page");
  return res.redirect(frontendErrorUrl.toString());
}

/**
 * Helper function to handle viewer OAuth callback
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Object} decodedState - Decoded OAuth state
 * @return {Promise<Object>} JSON response
 */
async function handleViewerCallback(req, res, decodedState) {
  logger.info("Handling viewer OAuth callback");
  const {code, error: twitchError, error_description: twitchErrorDescription} = req.query;

  if (twitchError) {
    logger.error({twitchError, twitchErrorDescription}, "Viewer OAuth error");
    return res.status(400).json({
      success: false,
      error: twitchError,
      error_description: twitchErrorDescription,
    });
  }

  try {
    // Exchange code for token
    const tokenResponse = await axios.post(TWITCH_TOKEN_URL, null, {
      params: {
        client_id: secrets.TWITCH_CLIENT_ID,
        client_secret: secrets.TWITCH_CLIENT_SECRET,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: config.CALLBACK_URL,
      },
    });

    const {access_token: accessToken} = tokenResponse.data;
    if (!accessToken) {
      throw new Error("No access token received from Twitch");
    }

    // Validate token and get user info
    const userInfo = await validateTwitchToken(accessToken);
    const userLogin = userInfo.login.toLowerCase();

    // Create JWT token for the viewer
    const viewerTokenPayload = {
      userId: userInfo.user_id,
      userLogin: userLogin,
      displayName: userInfo.login,
      scope: "viewer",
    };

    const viewerSessionToken = jwt.sign(viewerTokenPayload, secrets.JWT_SECRET, {
      expiresIn: "7d",
      issuer: "chatvibes-auth",
      audience: "chatvibes-api",
    });

    logger.info({userLogin}, "Generated viewer session token");

    // Redirect viewers back to the preferences page with a validated session token
    const redirectUrl = new URL(config.FRONTEND_URL);
    redirectUrl.pathname = "/viewer-settings.html";
    redirectUrl.searchParams.set("session_token", viewerSessionToken);
    redirectUrl.searchParams.set("validated", "1");
    // Preserve optional channel context if present in state
    if (decodedState && (decodedState.c || decodedState.channel)) {
      redirectUrl.searchParams.set("channel", decodedState.c || decodedState.channel);
    }

    return res.redirect(redirectUrl.toString());
  } catch (error) {
    logger.error({error: error.message}, "Viewer OAuth callback error");
    return res.status(500).json({
      success: false,
      error: "auth_failed",
      error_description: "Failed to complete viewer authentication",
    });
  }
}

// Route: /auth/twitch/initiate
router.get("/twitch/initiate", (req, res) => {
  logger.info("--- /auth/twitch/initiate HIT --- Version 1.2 ---");

  if (!secrets.TWITCH_CLIENT_ID || !config.CALLBACK_URL) {
    logger.error("Config missing for /auth/twitch/initiate: TWITCH_CLIENT_ID or CALLBACK_URL not found.");
    return res.status(500).json({success: false, error: "Server configuration error for Twitch auth."});
  }

  const state = crypto.randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: secrets.TWITCH_CLIENT_ID,
    redirect_uri: config.CALLBACK_URL,
    response_type: "code",
    scope: "user:read:email chat:read chat:edit channel:read:subscriptions bits:read moderator:read:followers channel:manage:redemptions channel:read:redemptions channel:manage:moderators",
    state: state,
    force_verify: "true",
  });
  const twitchAuthUrl = `${TWITCH_AUTH_URL}?${params.toString()}`;

  logger.info({state}, "Generated state");
  logger.debug({twitchAuthUrl}, "Twitch Auth URL to be sent to frontend");

  res.json({
    success: true,
    twitchAuthUrl: twitchAuthUrl,
    state: state,
  });
});

// Route: /auth/twitch/callback
router.get("/twitch/callback", async (req, res) => {
  logger.info("--- /auth/twitch/callback HIT ---");
  logger.debug({query: redactSensitive(req.query)}, "Callback Request Query Params");
  const {code, state: twitchQueryState, error: twitchError, error_description: twitchErrorDescription} = req.query;

  // Try to decode state parameter to detect viewer auth
  let isViewerAuth = false;
  let decodedState = null;
  try {
    decodedState = JSON.parse(Buffer.from(twitchQueryState, "base64").toString());
    if (decodedState && decodedState.t === "viewer") {
      isViewerAuth = true;
      logger.info("Detected viewer auth from state parameter");
    }
  } catch (error) {
    logger.debug("State is not viewer JSON format, treating as regular auth");
  }

  if (isViewerAuth) {
    logger.info("Detected viewer OAuth callback, delegating to viewer handler");
    return handleViewerCallback(req, res, decodedState);
  }

  if (twitchError) {
    logger.error({twitchError, twitchErrorDescription}, "Twitch OAuth explicit error");
    return redirectToFrontendWithError(res, twitchError, twitchErrorDescription, twitchQueryState);
  }

  try {
    logger.debug({callbackUrl: config.CALLBACK_URL}, "Exchanging code for token");
    const tokenResponse = await axios.post(TWITCH_TOKEN_URL, null, {
      params: {
        client_id: secrets.TWITCH_CLIENT_ID,
        client_secret: secrets.TWITCH_CLIENT_SECRET,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: config.CALLBACK_URL,
      },
    });

    const {access_token: accessToken, refresh_token: refreshToken} = tokenResponse.data;
    logger.info("Access token and refresh token received from Twitch.");

    if (!accessToken || !refreshToken) {
      logger.error({responseData: redactSensitive(tokenResponse.data)}, "Missing access_token or refresh_token from Twitch");
      throw new Error("Twitch did not return the expected tokens.");
    }

    const validateResponse = await axios.get(TWITCH_VALIDATE_URL, {
      headers: {Authorization: `OAuth ${accessToken}`},
    });

    if (validateResponse.data && validateResponse.data.user_id) {
      // Fetch user details including email
      const userResponse = await axios.get("https://api.twitch.tv/helix/users", {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Client-Id": secrets.TWITCH_CLIENT_ID,
        },
      });

      const userData = userResponse.data.data[0];
      const twitchUser = {
        id: validateResponse.data.user_id,
        login: validateResponse.data.login.toLowerCase(),
        displayName: userData?.display_name || validateResponse.data.login,
        email: userData?.email || null,
      };
      logger.info({userLogin: twitchUser.login}, "[AuthCallback] User authenticated and validated");

      if (!secrets.JWT_SECRET) {
        logger.error("JWT_SECRET is not configured.");
        return res.status(500).send("Server configuration error (JWT signing).");
      }

      const appTokenPayload = {
        userId: twitchUser.id,
        userLogin: twitchUser.login,
        displayName: twitchUser.displayName,
      };
      const appSessionToken = jwt.sign(appTokenPayload, secrets.JWT_SECRET, {
        expiresIn: "7d",
        issuer: "chatvibes-auth",
        audience: "chatvibes-api",
      });
      logger.info({userLogin: twitchUser.login}, "Generated app session token");

      const frontendAuthCompleteUrl = new URL(config.FRONTEND_URL);
      frontendAuthCompleteUrl.pathname = "/auth-complete.html";
      frontendAuthCompleteUrl.searchParams.append("user_login", twitchUser.login);
      frontendAuthCompleteUrl.searchParams.append("user_id", twitchUser.id);
      frontendAuthCompleteUrl.searchParams.append("state", twitchQueryState);
      frontendAuthCompleteUrl.searchParams.append("session_token", appSessionToken);

      logger.info({userLogin: twitchUser.login}, "Redirecting to frontend auth-complete page");

      // Store tokens securely
      if (db && secretManagerClient) {
        const userDocRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(twitchUser.login);
        const secretName = `projects/${config.GCLOUD_PROJECT}/secrets/twitch-refresh-token-${twitchUser.id}`;

        try {
          // Store refresh token in Secret Manager
          try {
            await secretManagerClient.createSecret({
              parent: `projects/${config.GCLOUD_PROJECT}`,
              secretId: `twitch-refresh-token-${twitchUser.id}`,
              secret: {replication: {automatic: {}}},
            });
          } catch (createError) {
            if (!createError.message.includes("already exists")) {
              throw createError;
            }
          }

          // Add secret version
          await secretManagerClient.addSecretVersion({
            parent: secretName,
            payload: {data: Buffer.from(refreshToken)},
          });

          // Store access token in Secret Manager
          const accessSecretName = `projects/${config.GCLOUD_PROJECT}/secrets/twitch-access-token-${twitchUser.id}`;
          try {
            await secretManagerClient.createSecret({
              parent: `projects/${config.GCLOUD_PROJECT}`,
              secretId: `twitch-access-token-${twitchUser.id}`,
              secret: {replication: {automatic: {}}},
            });
          } catch (createError) {
            if (!createError.message.includes("already exists")) {
              throw createError;
            }
          }

          await secretManagerClient.addSecretVersion({
            parent: accessSecretName,
            payload: {data: Buffer.from(accessToken)},
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
          }, {merge: true});

          logger.info({userLogin: twitchUser.login}, "Secret reference stored in Firestore");
        } catch (dbError) {
          logger.error({userLogin: twitchUser.login, error: dbError.message}, "Error storing secret");
          return redirectToFrontendWithError(res, "token_store_failed", "Failed to securely store Twitch credentials. Please try again.", twitchQueryState);
        }
      } else {
        logger.error("Firestore (db) or SecretManagerServiceClient not initialized. Cannot store Twitch tokens.");
      }

      // Automatically setup EventSub subscriptions for the authenticated streamer
      try {
        logger.info({userLogin: twitchUser.login}, "[AuthCallback] Setting up EventSub");
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
          logger.info({userLogin: twitchUser.login, result: eventSubResult}, "[AuthCallback] EventSub setup successful");
        } else {
          const errorText = await eventSubResponse.text();
          logger.warn({userLogin: twitchUser.login, status: eventSubResponse.status, error: errorText}, "[AuthCallback] EventSub setup failed");
        }
      } catch (eventSubError) {
        logger.error({userLogin: twitchUser.login, error: eventSubError.message}, "[AuthCallback] Error setting up EventSub");
        // Don't fail the auth process if EventSub setup fails
      }

      return res.redirect(frontendAuthCompleteUrl.toString());
    } else {
      logger.error("Failed to validate token or get user info from Twitch after token exchange.");
      throw new Error("Failed to validate token or get user info from Twitch.");
    }
  } catch (error) {
    logger.error({
      error: error.message,
      responseData: redactSensitive(error.response?.data),
      stack: error.stack,
    }, "[AuthCallback] Twitch OAuth callback error");
    return redirectToFrontendWithError(res, "auth_failed", error.message || "Authentication failed with Twitch due to an internal server error.", twitchQueryState);
  }
});

// Route: /auth/twitch/viewer
router.get("/twitch/viewer", (req, res) => {
  logger.info("--- /auth/twitch/viewer HIT ---");

  if (!secrets.TWITCH_CLIENT_ID || !config.CALLBACK_URL) {
    logger.error("Config missing: TWITCH_CLIENT_ID or CALLBACK_URL not found.");
    return res.status(500).json({success: false, error: "Server configuration error for Twitch viewer auth."});
  }

  // Create state parameter with viewer type marker
  const {channel} = req.query || {};
  const statePayload = {
    t: "viewer", // type: viewer
    r: crypto.randomBytes(8).toString("hex"), // random component
    c: channel || null, // optional channel context
  };
  const state = Buffer.from(JSON.stringify(statePayload)).toString("base64");

  const params = new URLSearchParams({
    client_id: secrets.TWITCH_CLIENT_ID,
    redirect_uri: config.CALLBACK_URL,
    response_type: "code",
    scope: "",
    state: state,
    force_verify: "true",
  });

  const twitchAuthUrl = `${TWITCH_AUTH_URL}?${params.toString()}`;
  logger.debug({twitchAuthUrl}, "Generated viewer auth URL");

  res.json({
    success: true,
    twitchAuthUrl: twitchAuthUrl,
    state: state,
  });
});

// Route: /auth/logout
router.get("/logout", (req, res) => {
  logger.info("--- /auth/logout HIT ---");
  res.json({success: true, message: "Logout successful. Please clear your session token on the client side."});
});


module.exports = router;
