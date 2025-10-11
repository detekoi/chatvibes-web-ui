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

  console.log(`Redirecting to frontend error page: ${frontendErrorUrl.toString()}`);
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
  console.log("Handling viewer OAuth callback");
  const {code, error: twitchError, error_description: twitchErrorDescription} = req.query;

  if (twitchError) {
    console.error(`Viewer OAuth error: ${twitchError} - ${twitchErrorDescription}`);
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

    console.log(`Generated viewer session token for ${userLogin}`);

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
    console.error("Viewer OAuth callback error:", error.message);
    return res.status(500).json({
      success: false,
      error: "auth_failed",
      error_description: "Failed to complete viewer authentication",
    });
  }
}

// Route: /auth/twitch/initiate
router.get("/twitch/initiate", (req, res) => {
  console.log("--- /auth/twitch/initiate HIT --- Version 1.2 ---");

  if (!secrets.TWITCH_CLIENT_ID || !config.CALLBACK_URL) {
    console.error("Config missing for /auth/twitch/initiate: TWITCH_CLIENT_ID or CALLBACK_URL not found.");
    return res.status(500).json({success: false, error: "Server configuration error for Twitch auth."});
  }

  const state = crypto.randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: secrets.TWITCH_CLIENT_ID,
    redirect_uri: config.CALLBACK_URL,
    response_type: "code",
    scope: "user:read:email chat:read chat:edit channel:read:subscriptions bits:read moderator:read:followers channel:manage:redemptions channel:read:redemptions",
    state: state,
    force_verify: "true",
  });
  const twitchAuthUrl = `${TWITCH_AUTH_URL}?${params.toString()}`;

  console.log(`Generated state: ${state}`);
  console.log(`Twitch Auth URL to be sent to frontend: ${twitchAuthUrl}`);

  res.json({
    success: true,
    twitchAuthUrl: twitchAuthUrl,
    state: state,
  });
});

// Route: /auth/twitch/callback
router.get("/twitch/callback", async (req, res) => {
  console.log("--- /auth/twitch/callback HIT ---");
  console.log("Callback Request Query Params:", JSON.stringify(req.query));
  const {code, state: twitchQueryState, error: twitchError, error_description: twitchErrorDescription} = req.query;

  // Try to decode state parameter to detect viewer auth
  let isViewerAuth = false;
  let decodedState = null;
  try {
    decodedState = JSON.parse(Buffer.from(twitchQueryState, "base64").toString());
    if (decodedState && decodedState.t === "viewer") {
      isViewerAuth = true;
      console.log("Detected viewer auth from state parameter");
    }
  } catch (error) {
    console.log("State is not viewer JSON format, treating as regular auth");
  }

  if (isViewerAuth) {
    console.log("Detected viewer OAuth callback, delegating to viewer handler");
    return handleViewerCallback(req, res, decodedState);
  }

  if (twitchError) {
    console.error(`Twitch OAuth explicit error: ${twitchError} - ${twitchErrorDescription}`);
    return redirectToFrontendWithError(res, twitchError, twitchErrorDescription, twitchQueryState);
  }

  try {
    console.log("Exchanging code for token. Callback redirect_uri used for exchange:", config.CALLBACK_URL);
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
    console.log("Access token and refresh token received from Twitch.");

    if (!accessToken || !refreshToken) {
      console.error("Missing access_token or refresh_token from Twitch.", tokenResponse.data);
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
      console.log(`[AuthCallback] User ${twitchUser.login} authenticated and validated.`);

      if (!secrets.JWT_SECRET) {
        console.error("JWT_SECRET is not configured.");
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
      console.log(`Generated app session token for ${twitchUser.login}`);

      const frontendAuthCompleteUrl = new URL(config.FRONTEND_URL);
      frontendAuthCompleteUrl.pathname = "/auth-complete.html";
      frontendAuthCompleteUrl.searchParams.append("user_login", twitchUser.login);
      frontendAuthCompleteUrl.searchParams.append("user_id", twitchUser.id);
      frontendAuthCompleteUrl.searchParams.append("state", twitchQueryState);
      frontendAuthCompleteUrl.searchParams.append("session_token", appSessionToken);

      console.log(`Redirecting to frontend auth-complete page: ${frontendAuthCompleteUrl.toString()}`);

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

          console.log(`Secret reference stored in Firestore for user ${twitchUser.login}`);
        } catch (dbError) {
          console.error(`Error storing secret for ${twitchUser.login}:`, dbError);
          return redirectToFrontendWithError(res, "token_store_failed", "Failed to securely store Twitch credentials. Please try again.", twitchQueryState);
        }
      } else {
        console.error("Firestore (db) or SecretManagerServiceClient not initialized. Cannot store Twitch tokens.");
      }

      // Automatically setup EventSub subscriptions for the authenticated streamer
      try {
        console.log(`[AuthCallback] Setting up EventSub for ${twitchUser.login}`);
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
          console.log(`[AuthCallback] EventSub setup successful for ${twitchUser.login}:`, eventSubResult);
        } else {
          console.warn(`[AuthCallback] EventSub setup failed for ${twitchUser.login}: ${eventSubResponse.status} ${await eventSubResponse.text()}`);
        }
      } catch (eventSubError) {
        console.error(`[AuthCallback] Error setting up EventSub for ${twitchUser.login}:`, eventSubError);
        // Don't fail the auth process if EventSub setup fails
      }

      return res.redirect(frontendAuthCompleteUrl.toString());
    } else {
      console.error("Failed to validate token or get user info from Twitch after token exchange.");
      throw new Error("Failed to validate token or get user info from Twitch.");
    }
  } catch (error) {
    console.error("[AuthCallback] Twitch OAuth callback error:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message, error.stack);
    return redirectToFrontendWithError(res, "auth_failed", error.message || "Authentication failed with Twitch due to an internal server error.", twitchQueryState);
  }
});

// Route: /auth/twitch/viewer
router.get("/twitch/viewer", (req, res) => {
  console.log("--- /auth/twitch/viewer HIT ---");

  if (!secrets.TWITCH_CLIENT_ID || !config.CALLBACK_URL) {
    console.error("Config missing: TWITCH_CLIENT_ID or CALLBACK_URL not found.");
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
  console.log(`Generated viewer auth URL: ${twitchAuthUrl}`);

  res.json({
    success: true,
    twitchAuthUrl: twitchAuthUrl,
    state: state,
  });
});

// Route: /auth/logout
router.get("/logout", (req, res) => {
  console.log("--- /auth/logout HIT ---");
  res.json({success: true, message: "Logout successful. Please clear your session token on the client side."});
});


module.exports = router;
