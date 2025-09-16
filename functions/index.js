// functions/index.js
/**
 * Twitch OAuth 2.0 Authentication and Bot Management API
 *
 * This Firebase Cloud Function provides Twitch OAuth authentication for users
 * who want to add the ChatVibes bot to their Twitch channel. It implements
 * the full OAuth flow including token refresh, validation, and management.
 *
 * Key features:
 * - Complete Twitch OAuth 2.0 authentication flow
 * - Secure token storage in Firestore
 * - Token refresh with retry logic and error handling
 * - Bot management (add/remove)
 * - User authentication state tracking
 *
 * Environment variables required:
 * - TWITCH_CLIENT_ID: Your Twitch application client ID
 * - TWITCH_CLIENT_SECRET: Your Twitch application client secret
 * - CALLBACK_URL: The OAuth callback URL (must match Twitch dev console)
 * - FRONTEND_URL_CONFIG: The URL of your frontend application
 * - JWT_SECRET_KEY: Secret for signing JWT tokens
 */

const functions = require("firebase-functions"); // Still needed for exports.webUi
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const {Firestore, FieldValue} = require("@google-cloud/firestore");
const {SecretManagerServiceClient} = require("@google-cloud/secret-manager");
const Replicate = require("replicate");
// const cors = require("cors");

// Initialize clients once per instance
let db; let secretManagerClient;
try {
  db = new Firestore();
  secretManagerClient = new SecretManagerServiceClient();
  console.log("[CloudFunctions] Firestore and Secret Manager clients initialized.");
} catch (e) {
  console.error("[CloudFunctions] Client initialization error:", e);
}

const CHANNELS_COLLECTION = "managedChannels";

const app = express();

// --- Global variables for secrets ---
let TWITCH_CLIENT_ID; let TWITCH_CLIENT_SECRET; let JWT_SECRET; let REPLICATE_API_TOKEN;

// --- These are configuration variables, not secrets. Load them directly. ---
const CALLBACK_REDIRECT_URI_CONFIG = process.env.CALLBACK_URL;
const FRONTEND_URL_CONFIG = process.env.FRONTEND_URL;
const OBS_BROWSER_BASE_URL = process.env.OBS_BROWSER_BASE_URL || "https://chatvibes-tts-service-h7kj56ct4q-uc.a.run.app";

// --- Asynchronous Secret Loading ---
const secretsLoaded = (async () => {
  try {
    const loadSecret = async (secretName) => {
      const [version] = await secretManagerClient.accessSecretVersion({
        name: `projects/${process.env.GCLOUD_PROJECT}/secrets/${secretName}/versions/latest`,
      });
      return version.payload.data.toString().trim();
    };

    [
      TWITCH_CLIENT_ID,
      TWITCH_CLIENT_SECRET,
      JWT_SECRET,
      REPLICATE_API_TOKEN,
    ] = await Promise.all([
      loadSecret("twitch-webui-client-id"),
      loadSecret("twitch-webui-client-secret"),
      loadSecret("jwt-secret-key"),
      loadSecret("replicate-api-token"),
    ]);

    console.log("✅ Successfully loaded all required secrets.");
  } catch (error) {
    console.error("CRITICAL: Failed to load secrets on startup.", error);
    throw new Error("Could not load necessary secrets to start the function.");
  }
})();

// --- Middleware to Ensure Secrets Are Loaded ---
// This middleware will make sure that no request is processed before secrets are ready.
app.use(async (req, res, next) => {
  try {
    await secretsLoaded; // Wait for the async loading to complete
    next(); // Proceed to the actual route handler
  } catch (error) {
    console.error("Function is not ready, secrets failed to load.", error.message);
    // Respond with a 503 Service Unavailable error if secrets aren't loaded
    res.status(503).send("Service Unavailable: Server is initializing or has a configuration error.");
  }
});

// --- CORS Configuration ---
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Build allowed origins list dynamically
  const allowedOrigins = new Set(["http://127.0.0.1:5002", "http://localhost:5002"]);

  // Add production frontend URL from environment
  if (FRONTEND_URL_CONFIG) {
    try {
      const url = new URL(FRONTEND_URL_CONFIG);
      allowedOrigins.add(`${url.protocol}//${url.host}`);
      // If using Firebase Hosting defaults, include both web.app and firebaseapp.com variants
      if (url.host.endsWith(".web.app")) {
        const altHost = url.host.replace(/\.web\.app$/, ".firebaseapp.com");
        allowedOrigins.add(`${url.protocol}//${altHost}`);
      } else if (url.host.endsWith(".firebaseapp.com")) {
        const altHost = url.host.replace(/\.firebaseapp\.com$/, ".web.app");
        allowedOrigins.add(`${url.protocol}//${altHost}`);
      }
    } catch (e) {
      console.warn("CORS: FRONTEND_URL is not a valid URL:", FRONTEND_URL_CONFIG);
    }
  } else {
    // Fallback: add hardcoded production URL if no FRONTEND_URL configured
    allowedOrigins.add("https://chatvibestts.web.app");
    allowedOrigins.add("https://chatvibestts.firebaseapp.com");
  }

  console.log(`CORS Check: Origin: ${origin} | Allowed: ${Array.from(allowedOrigins).join(", ")}`);

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

const TWITCH_AUTH_URL = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";

// Helper to get GCP project ID for Secret Manager (if not already defined)
function getProjectId() {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    throw new Error("GCP project ID not found in environment variables.");
  }
  return projectId;
}

// Normalize a Secret Manager reference to a Secret Version path
// Accepts:
// - full version path: projects/{project}/secrets/{secret}/versions/{version}
// - secret path without version: projects/{project}/secrets/{secret}
// - bare secret id: {secret}
// Returns a version path using "latest" when no version provided
function normalizeSecretVersionPath(secretInput) {
  if (!secretInput) return secretInput;
  if (secretInput.includes("/versions/")) return secretInput;
  if (secretInput.startsWith("projects/")) {
    return `${secretInput}/versions/latest`;
  }
  const projectId = getProjectId();
  return `projects/${projectId}/secrets/${secretInput}/versions/latest`;
}

// Load allow-listed channels from env CSV or Secret Manager
// If both ALLOWED_CHANNELS and ALLOWED_CHANNELS_SECRET_NAME are unset, allow all (no restrictions)
async function getAllowedChannelsList() {
  try {
    // First try environment variable (CSV)
    const ALLOWED_CHANNELS_ENV = (process.env.ALLOWED_CHANNELS || "")
        .split(",")
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);

    if (ALLOWED_CHANNELS_ENV.length > 0) {
      console.log(`[AllowList] Loaded ${ALLOWED_CHANNELS_ENV.length} entries from ALLOWED_CHANNELS env var: [${ALLOWED_CHANNELS_ENV.join(", ")}]`);
      return ALLOWED_CHANNELS_ENV;
    }

    // Fall back to Secret Manager if env not set
    const ALLOWED_CHANNELS_SECRET_NAME = process.env.ALLOWED_CHANNELS_SECRET_NAME;
    if (!ALLOWED_CHANNELS_SECRET_NAME) {
      console.log("[AllowList] No allow-list configured (ALLOWED_CHANNELS or ALLOWED_CHANNELS_SECRET_NAME). Allowing all channels.");
      return null; // null means no restrictions
    }

    const name = normalizeSecretVersionPath(ALLOWED_CHANNELS_SECRET_NAME);
    const [version] = await secretManagerClient.accessSecretVersion({name});
    const secretCsv = version.payload.data.toString("utf8");
    const list = secretCsv
        .split(",")
        .map((c) => c.trim().toLowerCase())
        .filter(Boolean);
    console.log(`[AllowList] Loaded ${list.length} entries from ALLOWED_CHANNELS_SECRET_NAME: [${list.join(", ")}]`);
    return list;
  } catch (e) {
    console.error("[AllowList] Error loading allow-list:", e.message);
    // On error, be permissive if no config is set (backwards compatibility)
    // but restrictive if config was attempted but failed
    const hasConfig = process.env.ALLOWED_CHANNELS || process.env.ALLOWED_CHANNELS_SECRET_NAME;
    if (hasConfig) {
      console.error("[AllowList] Allow-list configured but failed to load. Denying all for security.");
      return []; // Empty list = deny all
    } else {
      console.log("[AllowList] No allow-list configured and no error loading. Allowing all channels.");
      return null; // null means no restrictions
    }
  }
}

// Route: /auth/twitch/initiate
app.get("/auth/twitch/initiate", (req, res) => {
  console.log("--- /auth/twitch/initiate HIT --- Version 1.2 ---");
  const currentTwitchClientId = TWITCH_CLIENT_ID;
  const currentCallbackRedirectUri = CALLBACK_REDIRECT_URI_CONFIG;

  if (!currentTwitchClientId || !currentCallbackRedirectUri) {
    console.error("Config missing for /auth/twitch/initiate: TWITCH_CLIENT_ID or CALLBACK_URL not found in environment variables.");
    return res.status(500).json({success: false, error: "Server configuration error for Twitch auth."});
  }

  const state = crypto.randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: currentTwitchClientId,
    redirect_uri: currentCallbackRedirectUri,
    response_type: "code",
    scope: "user:read:email channel:manage:redemptions channel:read:redemptions",
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
app.get("/auth/twitch/callback", async (req, res) => {
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
    // Not a JSON state, probably regular auth
    console.log("State is not viewer JSON format, treating as regular auth");
  }

  // Check if this is a viewer auth callback
  if (isViewerAuth) {
    console.log("Detected viewer OAuth callback, delegating to viewer handler");
    return handleViewerCallback(req, res, decodedState);
  }

  if (twitchError) {
    console.error(`Twitch OAuth explicit error: ${twitchError} - ${twitchErrorDescription}`);
    return redirectToFrontendWithError(res, twitchError, twitchErrorDescription, twitchQueryState);
  }

  try {
    // The rest of the logic to exchange the code for a token remains the same.
    // It starts from here:
    console.log("Exchanging code for token. Callback redirect_uri used for exchange:", CALLBACK_REDIRECT_URI_CONFIG); // This is from .env
    const tokenResponse = await axios.post(TWITCH_TOKEN_URL, null, {
      params: {
        client_id: TWITCH_CLIENT_ID, // from .env
        client_secret: TWITCH_CLIENT_SECRET, // from .env
        code: code,
        grant_type: "authorization_code",
        redirect_uri: CALLBACK_REDIRECT_URI_CONFIG, // from .env
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
      const twitchUser = {
        id: validateResponse.data.user_id,
        login: validateResponse.data.login.toLowerCase(),
        displayName: validateResponse.data.login,
      };
      console.log(`[AuthCallback] User ${twitchUser.login} authenticated and validated.`);

      if (!JWT_SECRET) { // from .env
        console.error("JWT_SECRET is not configured in environment variables.");
        return res.status(500).send("Server configuration error (JWT signing).");
      }

      const appTokenPayload = {
        userId: twitchUser.id,
        userLogin: twitchUser.login,
        displayName: twitchUser.displayName,
      };
      const appSessionToken = jwt.sign(appTokenPayload, JWT_SECRET, {
        expiresIn: "1h", // Use a fixed expiration for now, as JWT_EXPIRATION is removed
        issuer: "chatvibes-auth",
        audience: "chatvibes-api",
      });
      console.log(`Generated app session token for ${twitchUser.login}`);

      const frontendAuthCompleteUrl = new URL(FRONTEND_URL_CONFIG); // from .env
      frontendAuthCompleteUrl.pathname = "/auth-complete.html";
      frontendAuthCompleteUrl.searchParams.append("user_login", twitchUser.login);
      frontendAuthCompleteUrl.searchParams.append("user_id", twitchUser.id);
      frontendAuthCompleteUrl.searchParams.append("state", twitchQueryState);
      frontendAuthCompleteUrl.searchParams.append("session_token", appSessionToken);

      console.log(`Redirecting to frontend auth-complete page: ${frontendAuthCompleteUrl.toString()}`);

      // Store tokens securely
      if (db && secretManagerClient) {
        const userDocRef = db.collection(CHANNELS_COLLECTION).doc(twitchUser.login);
        const secretName = `projects/${process.env.GCLOUD_PROJECT}/secrets/twitch-refresh-token-${twitchUser.id}`;
        try {
          // Create or update the secret in Secret Manager
          try {
            // Attempt to create the secret first.
            await secretManagerClient.createSecret({
              parent: `projects/${process.env.GCLOUD_PROJECT}`,
              secretId: `twitch-refresh-token-${twitchUser.id}`,
              secret: {
                replication: {automatic: {}},
              },
            });
          } catch (secretError) {
            if (secretError.code !== 6) { // 6 means "ALREADY_EXISTS"
              throw secretError;
            }
            // If it already exists, that's fine, we'll just add a new version.
          }

          // Add the new refresh token as a secret version.
          await secretManagerClient.addSecretVersion({
            parent: secretName,
            payload: {
              data: Buffer.from(refreshToken, "utf8"),
            },
          });
          console.log(`Twitch refresh token stored in Secret Manager for user ${twitchUser.login}`);

          // Now, store the reference to the secret in Firestore, NOT the token itself.
          // We no longer store the accessToken at all.
          await userDocRef.set({
            twitchRefreshTokenSecretName: secretName, // Store the secret name
            twitchUserId: twitchUser.id,
            displayName: twitchUser.displayName,
            lastLoginAt: FieldValue.serverTimestamp(),
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

      return res.redirect(frontendAuthCompleteUrl.toString());
    } else {
      console.error("Failed to validate token or get user info from Twitch after token exchange.");
      throw new Error("Failed to validate token or get user info from Twitch.");
    }
  } catch (error) {
    console.error("[AuthCallback] Twitch OAuth callback error:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message, error.stack);
    // Try to redirect to frontend with generic error if possible
    return redirectToFrontendWithError(res, "auth_failed", error.message || "Authentication failed with Twitch due to an internal server error.", twitchQueryState);
  }
});

// JWT Authentication Middleware
const authenticateApiRequest = (req, res, next) => {
  console.log(`--- authenticateApiRequest for ${req.path} ---`);
  const authHeader = req.headers.authorization;
  console.log("Received Authorization Header:", authHeader);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn("API Auth Middleware: Missing or malformed Authorization header.");
    return res.status(401).json({success: false, message: "Unauthorized: Missing or malformed token."});
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    console.warn("API Auth Middleware: Token not found after Bearer prefix.");
    return res.status(401).json({success: false, message: "Unauthorized: Token not found."});
  }
  console.log("API Auth Middleware: Token extracted:", token ? "Present" : "MISSING_OR_EMPTY");

  if (!JWT_SECRET) { // from .env
    console.error("API Auth: JWT_SECRET is not configured. Cannot verify token.");
    return res.status(500).json({success: false, message: "Server error: Auth misconfiguration."});
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: decoded.userId,
      login: decoded.userLogin,
      displayName: decoded.displayName,
      type: decoded.type,
      tokenUser: decoded.tokenUser,
      tokenChannel: decoded.tokenChannel,
    };
    console.log(`API Auth Middleware: User ${req.user.login} successfully authenticated. Decoded:`, JSON.stringify(decoded));
    next();
  } catch (err) {
    console.warn("API Auth Middleware: JWT verification failed.", err.message, err.name);
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({success: false, message: "Unauthorized: Token expired."});
    }
    return res.status(401).json({success: false, message: "Unauthorized: Invalid token."});
  }
};

// API Routes
app.get("/api/bot/status", authenticateApiRequest, async (req, res) => {
  const channelLogin = req.user.login;
  if (!db) {
    console.error("[API /status] Firestore (db) not initialized!");
    return res.status(500).json({success: false, message: "Firestore not available."});
  }

  try {
    // Ensure we have a valid Twitch token for this user
    try {
      await getValidTwitchTokenForUser(channelLogin);
      // Token is valid - proceed
    } catch (tokenError) {
      // Token refresh failed, but we can still check bot status
      console.warn(`[API /status] Token validation failed for ${channelLogin}, but continuing:`, tokenError.message);
    }

    const docRef = db.collection(CHANNELS_COLLECTION).doc(channelLogin);
    const docSnap = await docRef.get();
    if (docSnap.exists && docSnap.data().isActive) {
      res.json({
        success: true,
        isActive: true,
        channelName: docSnap.data().channelName || channelLogin,
        needsReAuth: docSnap.data().needsTwitchReAuth === true,
      });
    } else {
      res.json({
        success: true,
        isActive: false,
        channelName: channelLogin,
        needsReAuth: docSnap.exists && docSnap.data().needsTwitchReAuth === true,
      });
    }
  } catch (error) {
    console.error(`[API /status] Error getting status for ${channelLogin}:`, error);
    res.status(500).json({success: false, message: "Error fetching bot status."});
  }
});

app.post("/api/bot/add", authenticateApiRequest, async (req, res) => {
  const {id: twitchUserId, login: channelLogin, displayName} = req.user;
  if (!db) {
    console.error("[API /add] Firestore (db) not initialized!");
    return res.status(500).json({success: false, message: "Firestore not available."});
  }

  // Enforce allow-list FIRST (check BEFORE token validation to return accurate errors)
  try {
    const allowedList = await getAllowedChannelsList();
    // If allowedList is null, no restrictions are configured
    if (allowedList !== null) {
      const isAllowed = allowedList.includes(channelLogin.toLowerCase());
      if (!isAllowed) {
        console.warn(`[API /add] Channel ${channelLogin} is not allow-listed. Rejecting self-serve activation.`);
        return res.status(403).json({
          success: false,
          code: "not_allowed",
          message: "This channel is not permitted to add the bot.",
          details: "Access to the cloud version of ChatVibes is invite-only. If you'd like access, please contact the administrator via https://detekoi.github.io/#contact-me",
        });
      }
    }
  } catch (allowErr) {
    console.error("[API /add] Error during allow-list check:", allowErr.message);
    return res.status(500).json({success: false, message: "Server error during allow-list verification."});
  }

  // After allow-list passes, check if we have valid Twitch tokens for this user
  try {
    await getValidTwitchTokenForUser(channelLogin);
    console.log(`[API /add] Verified valid Twitch token for ${channelLogin}`);
  } catch (tokenError) {
    console.error(`[API /add] Token validation failed for ${channelLogin}:`, tokenError.message);
    return res.status(403).json({
      success: false,
      needsReAuth: true,
      message: "Your Twitch authentication has expired. Please reconnect your account.",
    });
  }

  const docRef = db.collection(CHANNELS_COLLECTION).doc(channelLogin);
  try {
    await docRef.set({
      channelName: channelLogin,
      twitchUserId: twitchUserId,
      displayName: displayName || channelLogin,
      isActive: true,
      addedBy: channelLogin,
      addedAt: FieldValue.serverTimestamp(),
      lastStatusChange: FieldValue.serverTimestamp(),
      // Mark as having valid auth
      needsTwitchReAuth: false,
    }, {merge: true});
    console.log(`[API /add] Bot activated for channel: ${channelLogin}`);
    res.json({
      success: true,
      message: `Bot has been requested for ${channelLogin}. It should join shortly!`,
    });
  } catch (error) {
    console.error(`[API /add] Error activating bot for ${channelLogin}:`, error);
    res.status(500).json({success: false, message: "Error requesting bot."});
  }
});

app.post("/api/bot/remove", authenticateApiRequest, async (req, res) => {
  const channelLogin = req.user.login;
  if (!db) {
    console.error("[API /remove] Firestore (db) not initialized!");
    return res.status(500).json({success: false, message: "Firestore not available."});
  }

  // Check authentication state, but don't block removal if token is invalid
  // We always want to allow users to remove the bot even if their auth has expired
  try {
    await getValidTwitchTokenForUser(channelLogin);
    console.log(`[API /remove] Verified valid Twitch token for ${channelLogin}`);
  } catch (tokenError) {
    // Log but continue - we'll allow removal even with expired tokens
    console.warn(`[API /remove] Token validation failed for ${channelLogin}, but continuing with removal:`, tokenError.message);
  }

  const docRef = db.collection(CHANNELS_COLLECTION).doc(channelLogin);
  try {
    const docSnap = await docRef.get();
    if (docSnap.exists) {
      await docRef.update({
        isActive: false,
        lastStatusChange: FieldValue.serverTimestamp(),
      });
      console.log(`[API /remove] Bot deactivated for channel: ${channelLogin}`);
      // Try to disable the TTS reward if present (non-blocking)
      try {
        await disableTtsChannelPointReward(channelLogin);
      } catch (disableErr) {
        console.warn(`[API /remove] Failed to disable TTS reward for ${channelLogin}:`, disableErr.message);
      }
      res.json({success: true, message: `Bot has been requested to leave ${channelLogin}.`});
    } else {
      res.json({success: false, message: "Bot was not in your channel."});
    }
  } catch (error) {
    console.error(`[API /remove] Error deactivating bot for ${channelLogin}:`, error);
    res.status(500).json({success: false, message: "Error requesting bot removal."});
  }
});

// TTS Test Route
app.post("/api/tts/test", authenticateApiRequest, async (req, res) => {
  console.log("[API /tts/test] Voice test request received");
  const {text, voiceId, emotion, pitch, speed, languageBoost, channel} = req.body;

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({
      success: false,
      message: "Text is required and must be a non-empty string.",
    });
  }

  if (text.length > 500) {
    return res.status(400).json({
      success: false,
      message: "Text must be 500 characters or less.",
    });
  }

  try {
    // Use the loaded REPLICATE_API_TOKEN, not process.env
    if (!REPLICATE_API_TOKEN) {
      console.error("[API /tts/test] Replicate API token not available.");
      return res.status(500).json({
        success: false,
        message: "TTS service configuration error.",
      });
    }

    const replicate = new Replicate({auth: REPLICATE_API_TOKEN});

    // Fetch channel defaults if any parameter is null and channel is provided
    let channelDefaults = {};
    if (channel && (voiceId === null || emotion === null || languageBoost === null || speed === null || pitch === null)) {
      try {
        console.log(`[API /tts/test] Fetching channel defaults for ${channel}`);
        const channelConfigDoc = await db.collection("ttsChannelConfigs").doc(channel.toLowerCase()).get();
        if (channelConfigDoc.exists) {
          channelDefaults = channelConfigDoc.data();
          console.log(`[API /tts/test] Found channel defaults for ${channel}:`, {
            voiceId: channelDefaults.voiceId,
            emotion: channelDefaults.emotion,
            languageBoost: channelDefaults.languageBoost,
            speed: channelDefaults.speed,
            pitch: channelDefaults.pitch,
          });
        } else {
          console.log(`[API /tts/test] No channel config found for ${channel}, using fallback defaults`);
        }
      } catch (error) {
        console.error(`[API /tts/test] Error fetching channel defaults for ${channel}:`, error);
      }
    }

    // Prepare TTS parameters with validation and defaults (use channel defaults when user preference is null)
    const input = {
      text: text.trim(),
      voice_id: voiceId || channelDefaults.voiceId || "Friendly_Person",
      speed: validateSpeed(speed !== null ? speed : channelDefaults.speed) || 1.0,
      volume: 1.0,
      pitch: validatePitch(pitch !== null ? pitch : channelDefaults.pitch) || 0,
      emotion: validateEmotion(emotion || channelDefaults.emotion) || "auto",
      language_boost: validateLanguageBoost(languageBoost || channelDefaults.languageBoost) || "Automatic",
      english_normalization: true,
      sample_rate: 32000,
      bitrate: 128000,
      channel: "mono",
    };

    console.log(`[API /tts/test] Generating TTS for user ${req.user.login} with voice ${input.voice_id}`);

    // Generate speech using Replicate
    const output = await replicate.run("minimax/speech-02-turbo", {input});

    if (typeof output === "string" && output.startsWith("https://")) {
      console.log(`[API /tts/test] TTS generated successfully for ${req.user.login}`);
      return res.json({
        success: true,
        audioUrl: output,
        message: "TTS generated successfully",
      });
    } else {
      console.error("[API /tts/test] Replicate returned unexpected output format:", output);
      return res.status(500).json({
        success: false,
        message: "TTS generation failed: unexpected response format.",
      });
    }
  } catch (error) {
    console.error("[API /tts/test] Error generating TTS:", error);
    return res.status(500).json({
      success: false,
      message: "TTS generation failed: " + error.message,
    });
  }
});

// Logout Route
app.get("/auth/logout", (req, res) => {
  console.log("Logout requested. Client should clear its token.");
  res.redirect(FRONTEND_URL_CONFIG); // from .env
});

// API route to check auth status and refresh token if needed
app.get("/api/auth/status", authenticateApiRequest, async (req, res) => {
  const userLogin = req.user.login;
  console.log(`[API /auth/status] Checking auth status for ${userLogin}`);

  if (!db) {
    console.error("[API /auth/status] Firestore (db) not initialized!");
    return res.status(500).json({success: false, message: "Firestore not available."});
  }

  try {
    // Attempt to get a valid token, which will refresh if needed
    // Token is valid if this doesn't throw an error
    await getValidTwitchTokenForUser(userLogin);

    // If we get here, token is valid (either existing or refreshed)
    return res.json({
      success: true,
      isAuthenticated: true,
      needsReAuth: false,
      message: "Twitch authentication is valid.",
    });
  } catch (error) {
    console.error(`[API /auth/status] Error getting valid token for ${userLogin}:`, error.message);

    // Check if this is a critical auth error that requires re-auth
    const needsReAuth = error.message.includes("re-authenticate") ||
                         error.message.includes("Refresh token not available") ||
                         error.message.includes("User not found");

    // User exists and is authenticated with our app (JWT), but Twitch tokens are invalid
    return res.status(403).json({
      success: false,
      isAuthenticated: true, // JWT is valid, but Twitch tokens aren't
      needsReAuth: needsReAuth,
      message: needsReAuth ?
        "Twitch authentication required. Please re-authenticate with Twitch." :
        "Error validating Twitch authentication.",
    });
  }
});

// API route to force token refresh
app.post("/api/auth/refresh", authenticateApiRequest, async (req, res) => {
  const userLogin = req.user.login;
  console.log(`[API /auth/refresh] Manual token refresh requested for ${userLogin}`);

  if (!db) {
    console.error("[API /auth/refresh] Firestore (db) not initialized!");
    return res.status(500).json({success: false, message: "Firestore not available."});
  }

  try {
    // Try to get a fresh token, which involves a full refresh cycle
    await getValidTwitchTokenForUser(userLogin);

    // If the above call succeeds, the refresh was successful.
    // We only need to update the Firestore document to clear any error state.
    const userDocRef = db.collection(CHANNELS_COLLECTION).doc(userLogin);
    await userDocRef.update({
      lastTokenRefreshAt: FieldValue.serverTimestamp(),
      needsTwitchReAuth: false,
      lastTokenError: null,
      lastTokenErrorAt: null,
    });

    console.log(`[API /auth/refresh] Successfully refreshed token for ${userLogin}`);
    return res.json({
      success: true,
      message: "Twitch authentication refreshed successfully.",
    });
  } catch (error) {
    console.error(`[API /auth/refresh] Failed to refresh token for ${userLogin}:`, error.message);
    return res.status(401).json({
      success: false,
      needsReAuth: true,
      message: "Failed to refresh Twitch authentication. Please re-authenticate.",
      error: error.message,
    });
  }
});

// Helper to redirect to frontend with error parameters
const redirectToFrontendWithError = (res, error, errorDescription, state) => {
  const frontendErrorUrl = new URL(FRONTEND_URL_CONFIG);
  frontendErrorUrl.pathname = "/auth-error.html"; // Or your preferred error page
  if (error) frontendErrorUrl.searchParams.append("error", error);
  if (errorDescription) frontendErrorUrl.searchParams.append("error_description", errorDescription);
  if (state) frontendErrorUrl.searchParams.append("state", state); // Pass original state back if available
  console.warn(`Redirecting to frontend error page: ${frontendErrorUrl.toString()}`);
  return res.redirect(frontendErrorUrl.toString());
};

/**
 * Refreshes a Twitch token using the refresh token with retry logic
 * @param {string} currentRefreshToken - The refresh token to use
 * @return {Promise<Object>} The new tokens and expiration
 */
async function refreshTwitchToken(currentRefreshToken) {
  if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET) {
    console.error("Twitch client ID or secret not configured for token refresh.");
    throw new Error("Server configuration error for Twitch token refresh.");
  }

  const MAX_RETRY_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 5000; // 5 seconds between retries
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    console.log(`Attempting to refresh Twitch token (Attempt ${attempt}/${MAX_RETRY_ATTEMPTS})`);
    try {
      const response = await axios.post(TWITCH_TOKEN_URL, null, {
        params: {
          grant_type: "refresh_token",
          refresh_token: currentRefreshToken,
          client_id: TWITCH_CLIENT_ID,
          client_secret: TWITCH_CLIENT_SECRET,
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 15000, // 15 second timeout
      });

      if (response.status === 200 && response.data && response.data.access_token) {
        console.log(`Successfully refreshed Twitch token on attempt ${attempt}.`);
        return {
          accessToken: response.data.access_token,
          refreshToken: response.data.refresh_token || currentRefreshToken, // Twitch might issue a new refresh token or keep the old one
          expiresIn: response.data.expires_in,
        };
      } else {
        // Should not happen if status is 200, but treat as an error
        lastError = new Error(`Failed to fetch token, unexpected response structure. Status: ${response.status}`);
        console.warn(`Attempt ${attempt} failed: ${lastError.message}`);
      }
    } catch (error) {
      lastError = error;
      const errorDetails = {
        message: error.message,
        code: error.code || "UNKNOWN",
        status: error.response && error.response.status,
        responseData: error.response && error.response.data,
        attempt: `${attempt}/${MAX_RETRY_ATTEMPTS}`,
      };

      console.error(`[refreshTwitchToken] Error refreshing token on attempt ${attempt}:`,
          JSON.stringify(errorDetails, null, 2));

      // Determine if this error is retryable
      let isRetryable = false;

      if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
        // Timeout errors are retryable
        isRetryable = true;
        console.warn(`Attempt ${attempt} timed out. Will retry if attempts remain.`);
      } else if (error.response) {
        if (error.response.status >= 500) {
          // Server errors are retryable
          isRetryable = true;
          console.warn(`Attempt ${attempt} failed with server error ${error.response.status}. Will retry if attempts remain.`);
        } else if (error.response.status === 429) {
          // Rate limiting is retryable
          isRetryable = true;
          console.warn(`Attempt ${attempt} rate limited (429). Will retry after delay.`);
        } else if (error.response.status === 400 || error.response.status === 401 || error.response.status === 403) {
          // Auth errors are NOT retryable - likely a bad refresh token or client credentials
          console.warn(`Refresh token is likely invalid or revoked (${error.response.status}). User needs to re-authenticate.`);
          isRetryable = false;
        }
      } else if (error.request) {
        // Network errors with no response are retryable
        isRetryable = true;
        console.warn(`Attempt ${attempt} failed with network error. Will retry if attempts remain.`);
      }

      // If retryable and not the last attempt, wait and try again
      if (isRetryable && attempt < MAX_RETRY_ATTEMPTS) {
        console.info(`Waiting ${RETRY_DELAY_MS/1000} seconds before retry attempt ${attempt + 1}...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }

      // If not retryable or last attempt, break out
      break;
    }
  }

  // If we get here, all retries failed
  let finalErrorMessage = `Failed to refresh Twitch token after ${MAX_RETRY_ATTEMPTS} attempts.`;
  if (lastError) {
    if (lastError.response) {
      finalErrorMessage += ` Status: ${lastError.response.status}, Data: ${JSON.stringify(lastError.response.data)}`;
      if (lastError.response.status === 400 || lastError.response.status === 401 || lastError.response.status === 403) {
        finalErrorMessage += " User needs to re-authenticate or client credentials are invalid.";
      }
    } else {
      finalErrorMessage += ` Error: ${lastError.message}`;
    }
  }
  throw new Error(finalErrorMessage);
}

/**
 * Gets a valid Twitch access token for a user, refreshing if necessary
 * by retrieving the refresh token from Secret Manager.
 * @param {string} userLogin - The user's login name
 * @return {Promise<string>} A valid, short-lived access token
 */
async function getValidTwitchTokenForUser(userLogin) {
  if (!db || !secretManagerClient) {
    console.error("[getValidTwitchTokenForUser] Firestore or Secret Manager client not initialized!");
    throw new Error("Server configuration error.");
  }

  const userDocRef = db.collection(CHANNELS_COLLECTION).doc(userLogin);
  const userDoc = await userDocRef.get();

  if (!userDoc.exists) {
    console.warn(`[getValidTwitchTokenForUser] User document for ${userLogin} not found.`);
    throw new Error("User not found or not authenticated with Twitch.");
  }

  const userData = userDoc.data();
  const {twitchRefreshTokenSecretName} = userData;

  if (!twitchRefreshTokenSecretName) {
    console.warn(`[getValidTwitchTokenForUser] No refresh token secret reference found for ${userLogin}. Re-authentication required.`);
    await userDocRef.update({needsTwitchReAuth: true});
    throw new Error("Refresh token not available. User needs to re-authenticate.");
  }

  console.log(`[getValidTwitchTokenForUser] Access token for ${userLogin} needs to be generated. Attempting refresh.`);
  try {
    // Access the refresh token from Secret Manager
    const [version] = await secretManagerClient.accessSecretVersion({
      name: `${twitchRefreshTokenSecretName}/versions/latest`,
    });
    const refreshToken = version.payload.data.toString("utf8");

    // Use the retrieved refresh token to get a new access token
    const newTokens = await refreshTwitchToken(refreshToken);

    // If Twitch provides a new refresh token, update it in Secret Manager
    if (newTokens.refreshToken && newTokens.refreshToken !== refreshToken) {
      await secretManagerClient.addSecretVersion({
        parent: twitchRefreshTokenSecretName,
        payload: {
          data: Buffer.from(newTokens.refreshToken, "utf8"),
        },
      });
      console.log(`[getValidTwitchTokenForUser] Updated refresh token in Secret Manager for ${userLogin}.`);
    }
    // We do NOT store the new access token. We return it for immediate use.
    console.log(`[getValidTwitchTokenForUser] Successfully generated ephemeral access token for ${userLogin}.`);
    return newTokens.accessToken;
  } catch (error) {
    console.error(`[getValidTwitchTokenForUser] Failed to refresh token for ${userLogin}:`, error.message);
    try {
      await userDocRef.update({
        needsTwitchReAuth: true,
        lastTokenError: error.message,
        lastTokenErrorAt: FieldValue.serverTimestamp(),
      });
      console.log(`[getValidTwitchTokenForUser] Marked user as needing re-auth: ${userLogin}`);
    } catch (updateError) {
      console.error(`[getValidTwitchTokenForUser] Failed to update user document for ${userLogin}:`, updateError.message);
    }

    throw new Error("Failed to obtain a valid Twitch token. User may need to re-authenticate.");
  }
}

/**
 * Ensures a Channel Points reward for TTS exists for a broadcaster. Creates or updates as needed.
 * Stores the reward ID in Firestore ttsChannelConfigs.{channel}.channelPointRewardId and
 * sets channelPointsEnabled true.
 * @param {string} channelLogin
 * @param {string} twitchUserId
 * @return {Promise<{status: string, rewardId: string}>}
 */
// eslint-disable-next-line no-unused-vars
async function ensureTtsChannelPointReward(channelLogin, twitchUserId) {
  if (!TWITCH_CLIENT_ID) {
    throw new Error("Server configuration error: missing TWITCH_CLIENT_ID");
  }

  // Acquire broadcaster token with required scopes
  const accessToken = await getValidTwitchTokenForUser(channelLogin);

  const helix = axios.create({
    baseURL: "https://api.twitch.tv/helix",
    headers: {
      "Client-ID": TWITCH_CLIENT_ID,
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });

  const desiredTitle = "Text-to-Speech Message";
  const desiredBody = {
    title: desiredTitle,
    cost: 500,
    prompt: "Enter a message to be read aloud by the TTS bot",
    is_user_input_required: true,
    should_redemptions_skip_request_queue: true,
    is_enabled: true,
  };

  // First, see if we already have a stored reward id
  let storedRewardId = null;
  try {
    const ttsDoc = await db.collection("ttsChannelConfigs").doc(channelLogin).get();
    if (ttsDoc.exists) {
      storedRewardId = ttsDoc.data().channelPointRewardId || null;
    }
  } catch (e) {
    console.warn(`[ensureTtsChannelPointReward] Could not read ttsChannelConfigs for ${channelLogin}:`, e.message);
  }

  // Helper to upsert the Firestore record
  const setFirestoreReward = async (rewardId) => {
    await db.collection("ttsChannelConfigs").doc(channelLogin).set({
      // New structured config
      channelPoints: {
        enabled: false,
        rewardId: rewardId,
        title: desiredBody.title,
        cost: desiredBody.cost,
        prompt: desiredBody.prompt,
        skipQueue: !!desiredBody.should_redemptions_skip_request_queue,
        cooldownSeconds: 0,
        perStreamLimit: 0,
        perUserPerStreamLimit: 0,
        contentPolicy: {
          minChars: 1,
          maxChars: 200,
          blockLinks: true,
          bannedWords: [],
        },
        lastSyncedAt: Date.now(),
      },
      // Legacy fields for backward compatibility (to be phased out)
      channelPointRewardId: rewardId,
      channelPointsEnabled: false,
    }, {merge: true});
  };

  // If we have an ID, try to update to desired settings for idempotency
  if (storedRewardId) {
    try {
      await helix.patch(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(twitchUserId)}&id=${encodeURIComponent(storedRewardId)}`, desiredBody);
      await setFirestoreReward(storedRewardId);
      return {status: "updated", rewardId: storedRewardId};
    } catch (e) {
      console.warn(`[ensureTtsChannelPointReward] Update existing reward failed for ${channelLogin}:`, e && e.response ? e.response.status : null, (e && e.response && e.response.data) || (e && e.message) || e);
      // Fall through to search/create
    }
  }

  // Query existing manageable rewards and try to find by title
  try {
    const listResp = await helix.get(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(twitchUserId)}&only_manageable_rewards=true`);
    const rewards = Array.isArray(listResp.data && listResp.data.data) ? listResp.data.data : [];
    const existing = rewards.find((r) => r.title === desiredTitle);
    if (existing) {
      // Update to desired settings in case they differ
      try {
        await helix.patch(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(twitchUserId)}&id=${encodeURIComponent(existing.id)}`, desiredBody);
      } catch (_e) {
        // Non-fatal if update fails; we can still use the reward as-is
        console.warn(`[ensureTtsChannelPointReward] Failed to update existing reward ${existing.id} for ${channelLogin}`);
      }
      await setFirestoreReward(existing.id);
      return {status: "reused", rewardId: existing.id};
    }
  } catch (e) {
    console.warn(`[ensureTtsChannelPointReward] Listing rewards failed for ${channelLogin}:`, e && e.response ? e.response.status : null, (e && e.response && e.response.data) || (e && e.message) || e);
  }

  // Create new reward
  const createResp = await helix.post(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(twitchUserId)}`, desiredBody);
  const newRewardId = createResp.data?.data?.[0]?.id;
  if (!newRewardId) {
    throw new Error("Failed to create TTS reward: missing reward id in response");
  }
  await setFirestoreReward(newRewardId);
  return {status: "created", rewardId: newRewardId};
}

/**
 * Disables the Channel Points TTS reward (sets is_enabled=false) if present.
 * @param {string} channelLogin
 */
async function disableTtsChannelPointReward(channelLogin) {
  // Read identifiers
  const managedDoc = await db.collection(CHANNELS_COLLECTION).doc(channelLogin).get();
  const ttsDoc = await db.collection("ttsChannelConfigs").doc(channelLogin).get();
  if (!managedDoc.exists || !ttsDoc.exists) return;
  const twitchUserId = managedDoc.data().twitchUserId;
  const rewardId = ttsDoc.data().channelPointRewardId;
  if (!twitchUserId || !rewardId) return;

  const accessToken = await getValidTwitchTokenForUser(channelLogin);
  const helix = axios.create({
    baseURL: "https://api.twitch.tv/helix",
    headers: {
      "Client-ID": TWITCH_CLIENT_ID,
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });

  try {
    await helix.patch(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(twitchUserId)}&id=${encodeURIComponent(rewardId)}`, {
      is_enabled: false,
    });
    await db.collection("ttsChannelConfigs").doc(channelLogin).set({
      channelPointsEnabled: false,
    }, {merge: true});
  } catch (e) {
    console.warn(`[disableTtsChannelPointReward] Failed to disable reward for ${channelLogin}:`, e.response?.status, e.response?.data || e.message);
  }
}

/**
 * Gets a secret from Google Secret Manager
 * @param {string} secretName - The name of the secret
 * @return {Promise<string>} The secret value
 */

/**
 * Validates TTS speed parameter
 * @param {number} speed - Speed value to validate
 * @return {number|null} Valid speed or null
 */
function validateSpeed(speed) {
  const parsed = parseFloat(speed);
  if (isNaN(parsed) || parsed < 0.5 || parsed > 2.0) {
    return null;
  }
  return parsed;
}

/**
 * Validates TTS pitch parameter
 * @param {number} pitch - Pitch value to validate
 * @return {number|null} Valid pitch or null
 */
function validatePitch(pitch) {
  const parsed = parseInt(pitch);
  if (isNaN(parsed) || parsed < -12 || parsed > 12) {
    return null;
  }
  return parsed;
}

/**
 * Validates TTS emotion parameter
 * @param {string} emotion - Emotion to validate
 * @return {string|null} Valid emotion or null
 */
function validateEmotion(emotion) {
  const validEmotions = [
    "auto", "neutral", "happy", "sad", "angry", "fearful", "disgusted", "surprised",
  ];
  return validEmotions.includes(emotion) ? emotion : null;
}

/**
 * Validates language boost parameter
 * @param {string} languageBoost - Language boost to validate
 * @return {string|null} Valid language boost or null
 */
function validateLanguageBoost(languageBoost) {
  const validLanguageBoosts = [
    "None", "Automatic", "Chinese", "Chinese,Yue", "English", "Arabic",
    "Russian", "Spanish", "French", "Portuguese", "German", "Turkish",
    "Dutch", "Ukrainian", "Vietnamese", "Indonesian", "Japanese",
    "Italian", "Korean", "Thai", "Polish", "Romanian", "Greek",
    "Czech", "Finnish", "Hindi",
  ];
  return validLanguageBoosts.includes(languageBoost) ? languageBoost : null;
}

// === Short Link Service ===
/**
 * Creates a short link with TTL for viewer preferences
 * @param {string} longUrl - The full URL to shorten
 * @return {string} - Short URL
 */
async function createShortLink(longUrl) {
  try {
    const slug = crypto.randomBytes(4).toString("hex"); // 8 character slug
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now

    await db.collection("shortLinks").doc(slug).set({
      url: longUrl,
      expires: expiresAt,
      created: new Date(),
    });

    return `https://chatvibestts.web.app/s/${slug}`;
  } catch (error) {
    console.error("Error creating short link:", error);
    throw new Error("Failed to create short link");
  }
}

// === Viewer Preferences API Routes ===

// Route: /auth/twitch/viewer - Initiate Twitch OAuth for viewer preferences
app.get("/auth/twitch/viewer", (req, res) => {
  console.log("--- /auth/twitch/viewer HIT ---");
  const {token, channel} = req.query;

  if (!token || !channel) {
    return res.status(400).json({success: false, error: "Token and channel are required"});
  }

  const currentTwitchClientId = TWITCH_CLIENT_ID;
  const currentCallbackRedirectUri = CALLBACK_REDIRECT_URI_CONFIG; // Use same callback as main auth

  if (!currentTwitchClientId) {
    console.error("Config missing for /auth/twitch/viewer: TWITCH_CLIENT_ID not found");
    return res.status(500).json({success: false, error: "Server configuration error"});
  }

  // Encode viewer info in the state parameter for reliability
  const baseState = crypto.randomBytes(12).toString("hex");
  const stateData = {
    s: baseState, // base state
    t: "viewer", // type: viewer auth
    vt: token, // viewer token
    vc: channel, // viewer channel
  };
  const state = Buffer.from(JSON.stringify(stateData)).toString("base64");


  const params = new URLSearchParams({
    client_id: currentTwitchClientId,
    redirect_uri: currentCallbackRedirectUri,
    response_type: "code",
    scope: "user:read:email",
    state: state,
    force_verify: "false",
  });

  const twitchAuthUrl = `${TWITCH_AUTH_URL}?${params.toString()}`;

  console.log(`Generated viewer auth state for secure access`);
  console.log(`Redirecting to Twitch OAuth for viewer validation`);

  res.json({
    success: true,
    twitchAuthUrl: twitchAuthUrl,
    state: state,
  });
});

/**
 * Handles the Twitch OAuth callback for viewer authentication and preference validation.
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {object} decodedState - Decoded state object from the OAuth state parameter
 */
async function handleViewerCallback(req, res, decodedState) {
  console.log("--- /auth/twitch/viewer-callback HIT ---");
  const {code, error: twitchError} = req.query;

  if (twitchError) {
    console.error(`Twitch OAuth error for viewer: ${twitchError}`);
    return res.redirect(`${FRONTEND_URL_CONFIG}/viewer-settings.html?error=oauth_failed`);
  }

  // Validate state parameter (only method we use)
  if (!decodedState || decodedState.t !== "viewer") {
    console.error("Invalid viewer state parameter");
    return res.redirect(`${FRONTEND_URL_CONFIG}/viewer-settings.html?error=state_mismatch`);
  }

  const viewerToken = decodedState.vt;
  const viewerChannel = decodedState.vc;
  console.log("Using viewer data from state parameter");

  if (!viewerToken || !viewerChannel) {
    console.error("Missing viewer token or channel from state parameter");
    return res.redirect(`${FRONTEND_URL_CONFIG}/viewer-settings.html?error=missing_data`);
  }

  try {
    // Exchange code for token
    const tokenResponse = await axios.post(TWITCH_TOKEN_URL, null, {
      params: {
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: CALLBACK_REDIRECT_URI_CONFIG, // Use same callback as main auth
      },
    });

    const {access_token: accessToken} = tokenResponse.data;

    if (!accessToken) {
      throw new Error("No access token received from Twitch");
    }

    // Validate the token and get user info
    const validateResponse = await axios.get(TWITCH_VALIDATE_URL, {
      headers: {Authorization: `OAuth ${accessToken}`},
    });

    if (!validateResponse.data || !validateResponse.data.login) {
      throw new Error("Failed to validate Twitch token or get user info");
    }

    const twitchUser = validateResponse.data.login.toLowerCase();

    // Verify the viewer token
    const decoded = jwt.verify(viewerToken, JWT_SECRET);
    const tokenUser = decoded.usr.toLowerCase();

    console.log("Viewer OAuth callback validation:", {
      actualUser: twitchUser,
      tokenUser: tokenUser,
      channel: viewerChannel,
      match: twitchUser === tokenUser,
    });

    // CRITICAL SECURITY CHECK
    if (twitchUser !== tokenUser) {
      console.log("SECURITY VIOLATION BLOCKED: User", twitchUser, "trying to access", tokenUser, "preferences via OAuth");
      return res.redirect(`${FRONTEND_URL_CONFIG}/viewer-settings.html?error=access_denied&message=${encodeURIComponent("You can only access your own preferences")}`);
    }

    // Success - create a session token with Twitch validation
    const sessionToken = jwt.sign(
        {
          userId: twitchUser,
          userLogin: twitchUser,
          displayName: twitchUser,
          type: "viewer",
          tokenUser: tokenUser,
          tokenChannel: decoded.ch,
          twitchValidated: true, // Mark as Twitch-validated
        },
        JWT_SECRET,
        {
          expiresIn: "24h",
          issuer: "chatvibes-auth",
          audience: "chatvibes-api",
        },
    );

    console.log("Viewer OAuth validation successful for:", twitchUser);

    // Redirect back to viewer settings with the session token
    const redirectUrl = new URL(`${FRONTEND_URL_CONFIG}/viewer-settings.html`);
    redirectUrl.searchParams.append("channel", viewerChannel);
    redirectUrl.searchParams.append("session_token", sessionToken);
    redirectUrl.searchParams.append("validated", "true");

    res.redirect(redirectUrl.toString());
  } catch (error) {
    console.error("Viewer OAuth callback error:", error.message);
    return res.redirect(`${FRONTEND_URL_CONFIG}/viewer-settings.html?error=auth_failed&message=${encodeURIComponent(error.message)}`);
  }
}

// Route: /api/viewer/auth - Authenticate with viewer token
app.post("/api/viewer/auth", async (req, res) => {
  try {
    const {token, twitchAccessToken} = req.body;

    if (!token) {
      return res.status(400).json({error: "Token is required"});
    }

    if (!JWT_SECRET) {
      return res.status(500).json({error: "Server configuration error"});
    }

    // Verify the viewer token
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log("Viewer token decoded:", {
      user: decoded.usr,
      channel: decoded.ch,
      type: decoded.typ,
    });

    if (decoded.typ !== "prefs") {
      return res.status(400).json({error: "Invalid token type"});
    }

    // Check if token requires Twitch authentication (newer tokens have this flag)
    const requiresTwitchAuth = decoded.requiresTwitchAuth === true;
    console.log("Token requires Twitch auth:", requiresTwitchAuth);

    // SECURITY: Validate actual Twitch user if access token provided
    if (twitchAccessToken) {
      try {
        // Verify the Twitch access token and get the actual user
        const twitchResponse = await axios.get(TWITCH_VALIDATE_URL, {
          headers: {Authorization: `OAuth ${twitchAccessToken}`},
        });

        if (twitchResponse.data && twitchResponse.data.login) {
          const actualTwitchUser = twitchResponse.data.login.toLowerCase();
          const tokenUser = decoded.usr.toLowerCase();

          console.log("Twitch OAuth validation:", {
            actualUser: actualTwitchUser,
            tokenUser: tokenUser,
            match: actualTwitchUser === tokenUser,
          });

          // CRITICAL SECURITY CHECK: Only allow access if the actual Twitch user matches the token user
          if (actualTwitchUser !== tokenUser) {
            console.log("SECURITY VIOLATION BLOCKED: User", actualTwitchUser, "trying to access", tokenUser, "preferences");
            return res.status(403).json({
              error: "Access denied: You can only access your own preferences",
              details: "The preferences link is for a different user",
            });
          }

          console.log("Security validation passed: User", actualTwitchUser, "accessing their own preferences");
        } else {
          console.warn("Invalid Twitch access token provided");
          return res.status(401).json({error: "Invalid Twitch authentication"});
        }
      } catch (twitchError) {
        console.error("Twitch validation failed:", twitchError.message);
        return res.status(401).json({error: "Failed to validate Twitch authentication"});
      }
    } else if (requiresTwitchAuth) {
      // Token requires Twitch auth but none provided - return flag to frontend
      console.log("Token requires Twitch authentication but none provided");
      return res.json({
        requiresTwitchAuth: true,
        tokenUser: decoded.usr,
        tokenChannel: decoded.ch,
        message: "Twitch authentication required for security validation",
      });
    }

    // Create a new session token for the SPECIFIC viewer
    const sessionToken = jwt.sign(
        {
          userId: decoded.usr,
          userLogin: decoded.usr,
          displayName: decoded.usr,
          type: "viewer",
          tokenUser: decoded.usr, // Store the original token user for validation
          tokenChannel: decoded.ch, // Store the original channel
        },
        JWT_SECRET,
        {
          expiresIn: "24h",
          issuer: "chatvibes-auth",
          audience: "chatvibes-api",
        },
    );

    console.log("Created session token for viewer:", decoded.usr);

    res.json({
      sessionToken,
      user: {
        login: decoded.usr,
        displayName: decoded.usr,
      },
      tokenChannel: decoded.ch,
      tokenUser: decoded.usr,
      requiresTwitchAuth: !twitchAccessToken, // Indicate if additional auth is needed
    });
  } catch (error) {
    console.error("Viewer auth error:", error);
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({error: "Token expired"});
    }
    res.status(401).json({error: "Invalid token"});
  }
});

// Route: /api/viewer/preferences/:channel - Get viewer preferences
app.get("/api/viewer/preferences/:channel", authenticateApiRequest, async (req, res) => {
  try {
    const {channel} = req.params;
    const username = req.user.login;

    if (!channel) {
      return res.status(400).json({error: "Channel is required"});
    }

    // Security check: ensure the authenticated user matches the token user
    if (req.user.type === "viewer" && req.user.tokenUser && req.user.tokenUser !== username) {
      console.log("SECURITY VIOLATION BLOCKED: User", username, "trying to access", req.user.tokenUser, "preferences in GET");
      return res.status(403).json({error: "Access denied: token user mismatch"});
    }

    // Check if channel exists and has TTS enabled
    const channelDoc = await db.collection("ttsChannelConfigs").doc(channel).get();

    if (!channelDoc.exists) {
      return res.status(404).json({error: "Channel not found or TTS not enabled"});
    }

    const channelData = channelDoc.data();
    const userPrefs = (channelData.userPreferences || {})[username] || {};

    // Check if user is ignored
    const ttsIgnored = (channelData.ignoredUsers || []).includes(username);

    // Check music ignore status
    let musicIgnored = false;
    try {
      const musicDoc = await db.collection("musicSettings").doc(channel).get();
      if (musicDoc.exists) {
        musicIgnored = ((musicDoc.data().ignoredUsers || []).includes(username));
      }
    } catch (error) {
      console.warn("Failed to check music ignore status:", error);
    }

    res.json({
      ...userPrefs,
      ttsIgnored,
      musicIgnored,
      channelExists: true,
      channelDefaults: {
        voiceId: channelData.voiceId || null,
        pitch: channelData.pitch || null,
        speed: channelData.speed || null,
        emotion: channelData.emotion || null,
        language: channelData.languageBoost || null,
      },
    });
  } catch (error) {
    console.error("Error fetching viewer preferences:", error);
    res.status(500).json({error: "Internal server error"});
  }
});

// Route: /api/viewer/preferences/:channel - Update viewer preferences
app.put("/api/viewer/preferences/:channel", authenticateApiRequest, async (req, res) => {
  try {
    const {channel} = req.params;
    const username = req.user.login;
    const updates = req.body;

    if (!channel) {
      return res.status(400).json({error: "Channel is required"});
    }

    // Security check: ensure the authenticated user matches the token user
    if (req.user.type === "viewer" && req.user.tokenUser && req.user.tokenUser !== username) {
      console.log("SECURITY VIOLATION BLOCKED: User", username, "trying to access", req.user.tokenUser, "preferences in PUT");
      return res.status(403).json({error: "Access denied: token user mismatch"});
    }

    // Validate updates
    const validKeys = ["voiceId", "pitch", "speed", "emotion", "language"];
    const filteredUpdates = {};

    for (const [key, value] of Object.entries(updates)) {
      if (!validKeys.includes(key)) {
        continue;
      }

      // Validate values
      if (key === "pitch") {
        if (value !== null) {
          const pitch = Number(value);
          if (isNaN(pitch) || pitch < -12 || pitch > 12) {
            return res.status(400).json({error: "Invalid pitch value"});
          }
          filteredUpdates[key] = pitch;
        } else {
          filteredUpdates[key] = null;
        }
      } else if (key === "speed") {
        if (value !== null) {
          const speed = Number(value);
          if (isNaN(speed) || speed < 0.5 || speed > 2) {
            return res.status(400).json({error: "Invalid speed value"});
          }
          filteredUpdates[key] = speed;
        } else {
          filteredUpdates[key] = null;
        }
      } else if (key === "emotion") {
        if (value !== null && value !== "") {
          const validEmotions = ["auto", "neutral", "happy", "sad", "angry", "fearful", "disgusted", "surprised"];
          if (!validEmotions.includes(value)) {
            return res.status(400).json({error: "Invalid emotion value"});
          }
          filteredUpdates[key] = value;
        } else {
          filteredUpdates[key] = null;
        }
      } else if (key === "language") {
        if (value !== null && value !== "") {
          const validLanguages = [
            "None", "Automatic", "Chinese", "Chinese,Yue", "English", "Arabic", "Russian",
            "Spanish", "French", "Portuguese", "German", "Turkish", "Dutch", "Ukrainian",
            "Vietnamese", "Indonesian", "Japanese", "Italian", "Korean", "Thai", "Polish",
            "Romanian", "Greek", "Czech", "Finnish", "Hindi",
          ];
          if (!validLanguages.includes(value)) {
            return res.status(400).json({error: "Invalid language value"});
          }
          filteredUpdates[key] = value;
        } else {
          filteredUpdates[key] = null;
        }
      } else if (key === "voiceId") {
        filteredUpdates[key] = value;
      }
    }

    // Build Firestore update object
    const updateObject = {};
    for (const [key, value] of Object.entries(filteredUpdates)) {
      if (value === null || value === "") {
        // Remove the preference
        updateObject[`userPreferences.${username}.${key}`] = FieldValue.delete();
      } else {
        // Set the preference
        updateObject[`userPreferences.${username}.${key}`] = value;
      }
    }

    if (Object.keys(updateObject).length > 0) {
      await db.collection("ttsChannelConfigs").doc(channel).update(updateObject);
    }

    res.json({success: true});
  } catch (error) {
    console.error("Error updating viewer preferences:", error);
    res.status(500).json({error: "Internal server error"});
  }
});

// Route: /api/viewer/ignore/tts/:channel - Add user to TTS ignore list
app.post("/api/viewer/ignore/tts/:channel", authenticateApiRequest, async (req, res) => {
  try {
    const {channel} = req.params;
    const username = req.user.login;

    // Security check: ensure the authenticated user matches the token user
    console.log("TTS Ignore Security Check:", {
      userType: req.user.type,
      currentUser: username,
      tokenUser: req.user.tokenUser,
      mismatch: req.user.tokenUser && req.user.tokenUser !== username,
    });

    if (req.user.type === "viewer" && req.user.tokenUser && req.user.tokenUser !== username) {
      console.log("SECURITY VIOLATION: User", username, "trying to access", req.user.tokenUser, "preferences");
      return res.status(403).json({error: "Access denied: token user mismatch"});
    }

    await db.collection("ttsChannelConfigs").doc(channel).update({
      ignoredUsers: FieldValue.arrayUnion(username),
    });

    res.json({success: true});
  } catch (error) {
    console.error("Error adding user to TTS ignore list:", error);
    res.status(500).json({error: "Internal server error"});
  }
});

// Route: /api/viewer/ignore/music/:channel - Add user to music ignore list
app.post("/api/viewer/ignore/music/:channel", authenticateApiRequest, async (req, res) => {
  try {
    const {channel} = req.params;
    const username = req.user.login;

    // Security check: ensure the authenticated user matches the token user
    console.log("Music Ignore Security Check:", {
      userType: req.user.type,
      currentUser: username,
      tokenUser: req.user.tokenUser,
      mismatch: req.user.tokenUser && req.user.tokenUser !== username,
    });

    if (req.user.type === "viewer" && req.user.tokenUser && req.user.tokenUser !== username) {
      console.log("SECURITY VIOLATION: User", username, "trying to access", req.user.tokenUser, "preferences");
      return res.status(403).json({error: "Access denied: token user mismatch"});
    }

    await db.collection("musicSettings").doc(channel).update({
      ignoredUsers: FieldValue.arrayUnion(username),
    });

    res.json({success: true});
  } catch (error) {
    console.error("Error adding user to music ignore list:", error);
    res.status(500).json({error: "Internal server error"});
  }
});


// Route: /api/shortlink - Create short link
app.post("/api/shortlink", async (req, res) => {
  try {
    const {url} = req.body;

    if (!url) {
      return res.status(400).json({error: "URL is required"});
    }

    const shortUrl = await createShortLink(url);
    res.json({shortUrl});
  } catch (error) {
    console.error("Error creating short link:", error);
    res.status(500).json({error: "Failed to create short link"});
  }
});

// Route: /s/:slug - Short link redirect
app.get("/s/:slug", async (req, res) => {
  const {slug} = req.params;

  if (!slug) {
    return res.status(400).send("Missing slug");
  }

  try {
    const doc = await db.collection("shortLinks").doc(slug).get();

    if (!doc.exists) {
      return res.status(404).send("Link not found or expired");
    }

    const data = doc.data();
    const now = new Date();

    if (now > data.expires.toDate()) {
      // Clean up expired link
      await db.collection("shortLinks").doc(slug).delete();
      return res.status(410).send("Link expired");
    }

    // Delete the link after first use (single-use)
    // await db.collection("shortLinks").doc(slug).delete();

    // Redirect to the actual viewer settings page
    res.redirect(302, data.url);
  } catch (error) {
    console.error("Error processing short link:", error);
    res.status(500).send("Internal server error");
  }
});

// Route: /api/obs/getToken - Get existing OBS token or generate new one
app.get("/api/obs/getToken", authenticateApiRequest, async (req, res) => {
  const channelLogin = req.user.login;
  console.log(`[API /obs/getToken] OBS token retrieval requested for ${channelLogin}`);

  if (!db || !secretManagerClient) {
    console.error("[API /obs/getToken] Firestore or Secret Manager client not initialized!");
    return res.status(500).json({success: false, message: "Server configuration error."});
  }

  try {
    // Check if user has valid Twitch tokens
    try {
      await getValidTwitchTokenForUser(channelLogin);
      console.log(`[API /obs/getToken] Verified valid Twitch token for ${channelLogin}`);
    } catch (tokenError) {
      console.error(`[API /obs/getToken] Token validation failed for ${channelLogin}:`, tokenError.message);
      return res.status(403).json({
        success: false,
        needsReAuth: true,
        message: "Your Twitch authentication has expired. Please reconnect your account.",
      });
    }

    // Check if user already has an OBS token
    const userDocRef = db.collection(CHANNELS_COLLECTION).doc(channelLogin);
    const userDoc = await userDocRef.get();

    if (userDoc.exists && userDoc.data().obsTokenSecretName) {
      try {
        // Try to retrieve the existing token
        const secretName = userDoc.data().obsTokenSecretName;
        const [version] = await secretManagerClient.accessSecretVersion({
          name: secretName,
        });
        const existingToken = version.payload.data.toString("utf8");

        // Generate the existing OBS Browser Source URL
        const obsWebSocketUrl = `${OBS_BROWSER_BASE_URL}/?channel=${channelLogin}&token=${existingToken}`;

        console.log(`[API /obs/getToken] Retrieved existing OBS token for ${channelLogin}`);

        return res.json({
          success: true,
          obsWebSocketUrl: obsWebSocketUrl,
          token: existingToken,
          isExisting: true,
          message: "Retrieved existing OBS Browser Source URL.",
        });
      } catch (secretError) {
        console.error(`[API /obs/getToken] Error retrieving existing token for ${channelLogin}:`, secretError);
        // Fall through to generate new token
      }
    }

    // No existing token or error retrieving it, return indication that user needs to generate one
    res.json({
      success: true,
      hasToken: false,
      message: "No OBS token found. Use the regenerate option to create one.",
    });
  } catch (error) {
    console.error(`[API /obs/getToken] Error checking OBS token for ${channelLogin}:`, error);
    res.status(500).json({
      success: false,
      message: "Failed to check OBS token: " + error.message,
    });
  }
});

// === Rewards Management Endpoints ===
// GET current TTS reward config and Twitch status
app.get("/api/rewards/tts", authenticateApiRequest, async (req, res) => {
  try {
    const channelLogin = req.user.login;
    const doc = await db.collection("ttsChannelConfigs").doc(channelLogin).get();
    const data = doc.exists ? doc.data() : {};
    const channelPoints = data.channelPoints || null;

    let twitchStatus = null;
    if (channelPoints?.rewardId) {
      try {
        const accessToken = await getValidTwitchTokenForUser(channelLogin);
        const helix = axios.create({
          baseURL: "https://api.twitch.tv/helix",
          headers: {"Client-ID": TWITCH_CLIENT_ID, "Authorization": `Bearer ${accessToken}`},
          timeout: 10000,
        });
        const broadcasterId = data.twitchUserId || req.user.id; // fallback to JWT user id
        const resp = await helix.get(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(broadcasterId)}&id=${encodeURIComponent(channelPoints.rewardId)}`);
        twitchStatus = Array.isArray(resp.data?.data) && resp.data.data.length > 0 ? resp.data.data[0] : null;
      } catch (e) {
        console.warn("[GET /api/rewards/tts] Twitch lookup failed:", e.response?.status, e.response?.data || e.message);
      }
    }

    return res.json({success: true, channelPoints, twitchStatus});
  } catch (error) {
    console.error("[GET /api/rewards/tts] Error:", error);
    res.status(500).json({success: false, error: "Failed to load reward config"});
  }
});

// POST create or update TTS reward and persist config
app.post("/api/rewards/tts", authenticateApiRequest, async (req, res) => {
  try {
    const channelLogin = req.user.login;
    const broadcasterId = req.user.id;
    const body = req.body || {};

    // Normalize and validate incoming config minimally (server-side)
    const enabled = !!body.enabled;
    const title = (body.title || "Text-to-Speech Message").toString().slice(0, 45);
    const cost = Math.max(1, Math.min(999999, parseInt(body.cost || 500, 10)));
    const prompt = (body.prompt || "Enter a message to be read aloud").toString().slice(0, 100);
    const skipQueue = body.skipQueue !== false;
    const cooldownSeconds = Math.max(0, Math.min(3600, parseInt(body.cooldownSeconds || 0, 10)));
    const perStreamLimit = Math.max(0, Math.min(1000, parseInt(body.perStreamLimit || 0, 10)));
    const perUserPerStreamLimit = Math.max(0, Math.min(1000, parseInt(body.perUserPerStreamLimit || 0, 10)));
    const contentPolicy = {
      minChars: Math.max(0, Math.min(500, parseInt(body.contentPolicy?.minChars ?? 1, 10))),
      maxChars: Math.max(1, Math.min(500, parseInt(body.contentPolicy?.maxChars ?? 200, 10))),
      blockLinks: !!(body.contentPolicy?.blockLinks ?? true),
      bannedWords: Array.isArray(body.contentPolicy?.bannedWords) ? body.contentPolicy.bannedWords.slice(0, 200) : [],
    };
    if (contentPolicy.minChars > contentPolicy.maxChars) {
      return res.status(400).json({success: false, error: "minChars must be ≤ maxChars"});
    }

    // Current doc values
    const docRef = db.collection("ttsChannelConfigs").doc(channelLogin);
    const snap = await docRef.get();
    const current = snap.exists ? (snap.data().channelPoints || {}) : {};
    const rewardId = current.rewardId || null;

    // If disabling and reward exists, disable on Twitch
    const accessToken = await getValidTwitchTokenForUser(channelLogin);
    const helix = axios.create({
      baseURL: "https://api.twitch.tv/helix",
      headers: {"Client-ID": TWITCH_CLIENT_ID, "Authorization": `Bearer ${accessToken}`},
      timeout: 15000,
    });

    if (!enabled && rewardId) {
      try {
        await helix.patch(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(broadcasterId)}&id=${encodeURIComponent(rewardId)}`, {is_enabled: false});
      } catch (e) {
        console.warn("[POST /api/rewards/tts] Disable failed:", e.response?.status, e.response?.data || e.message);
      }
    }

    // If enabling: create or update reward
    let finalRewardId = rewardId;
    if (enabled) {
      const rewardPayload = {
        title,
        cost,
        prompt,
        is_user_input_required: true,
        should_redemptions_skip_request_queue: !!skipQueue,
        is_enabled: true,
      };
      if (cooldownSeconds > 0) rewardPayload.global_cooldown_seconds = cooldownSeconds;
      if (perStreamLimit > 0) {
        rewardPayload.is_max_per_stream_enabled = true;
        rewardPayload.max_per_stream = perStreamLimit;
      }
      if (perUserPerStreamLimit > 0) {
        rewardPayload.is_max_per_user_per_stream_enabled = true;
        rewardPayload.max_per_user_per_stream = perUserPerStreamLimit;
      }

      try {
        if (finalRewardId) {
          await helix.patch(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(broadcasterId)}&id=${encodeURIComponent(finalRewardId)}`, rewardPayload);
        } else {
          const createResp = await helix.post(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(broadcasterId)}`, rewardPayload);
          finalRewardId = createResp.data?.data?.[0]?.id;
          if (!finalRewardId) throw new Error("Create reward response missing id");
        }
      } catch (e) {
        // If title conflict or update fails, try to find by title then update
        try {
          const listResp = await helix.get(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(broadcasterId)}&only_manageable_rewards=true`);
          const rewards = Array.isArray(listResp.data?.data) ? listResp.data.data : [];
          const existing = rewards.find((r) => r.title === title);
          if (existing) {
            finalRewardId = existing.id;
            await helix.patch(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(broadcasterId)}&id=${encodeURIComponent(finalRewardId)}`, rewardPayload);
          } else {
            throw e;
          }
        } catch (inner) {
          console.error("[POST /api/rewards/tts] Create/Update failed:", inner.response?.status, inner.response?.data || inner.message);
          return res.status(500).json({success: false, error: "Failed to create or update reward"});
        }
      }
    }

    // Persist Firestore config
    const savePayload = {
      channelPoints: {
        enabled,
        rewardId: finalRewardId || null,
        title,
        cost,
        prompt,
        skipQueue,
        cooldownSeconds,
        perStreamLimit,
        perUserPerStreamLimit,
        contentPolicy,
        lastSyncedAt: Date.now(),
      },
      channelPointRewardId: finalRewardId || null, // legacy
      channelPointsEnabled: enabled, // legacy
    };
    await docRef.set(savePayload, {merge: true});

    return res.json({success: true, rewardId: finalRewardId || undefined});
  } catch (error) {
    console.error("[POST /api/rewards/tts] Error:", error);
    res.status(500).json({success: false, error: "Server error"});
  }
});

// DELETE reward (nuke)
app.delete("/api/rewards/tts", authenticateApiRequest, async (req, res) => {
  try {
    const channelLogin = req.user.login;
    const docRef = db.collection("ttsChannelConfigs").doc(channelLogin);
    const snap = await docRef.get();
    const current = snap.exists ? (snap.data().channelPoints || {}) : {};
    const rewardId = current.rewardId;

    if (rewardId) {
      try {
        const accessToken = await getValidTwitchTokenForUser(channelLogin);
        const helix = axios.create({
          baseURL: "https://api.twitch.tv/helix",
          headers: {"Client-ID": TWITCH_CLIENT_ID, "Authorization": `Bearer ${accessToken}`},
          timeout: 10000,
        });
        const broadcasterId = (snap.data() && snap.data().twitchUserId) || req.user.id;
        await helix.delete(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(broadcasterId)}&id=${encodeURIComponent(rewardId)}`);
      } catch (e) {
        console.warn("[DELETE /api/rewards/tts] Twitch delete failed:", e.response?.status, e.response?.data || e.message);
      }
    }

    await docRef.set({
      channelPoints: {
        enabled: false,
        rewardId: null,
        lastSyncedAt: Date.now(),
      },
      channelPointRewardId: null,
      channelPointsEnabled: false,
    }, {merge: true});

    return res.json({success: true});
  } catch (error) {
    console.error("[DELETE /api/rewards/tts] Error:", error);
    res.status(500).json({success: false, error: "Server error"});
  }
});

// POST test redeem (simulate)
app.post("/api/rewards/tts:test", authenticateApiRequest, async (req, res) => {
  try {
    const channelLogin = req.user.login;
    const {text} = req.body || {};
    if (!text || typeof text !== "string") {
      return res.status(400).json({success: false, error: "Text is required"});
    }

    const cfgSnap = await db.collection("ttsChannelConfigs").doc(channelLogin).get();
    const cp = cfgSnap.exists ? (cfgSnap.data().channelPoints || {}) : {};
    if (!cp.enabled) return res.status(400).json({success: false, error: "Channel Points TTS is disabled"});

    const p = cp.contentPolicy || {};
    const minChars = typeof p.minChars === "number" ? p.minChars : 1;
    const maxChars = typeof p.maxChars === "number" ? p.maxChars : 200;
    const blockLinks = p.blockLinks !== false;
    const bannedWords = Array.isArray(p.bannedWords) ? p.bannedWords : [];

    const trimmed = text.trim();
    if (trimmed.length < minChars) return res.status(400).json({success: false, error: `Too short (< ${minChars})`});
    if (trimmed.length > maxChars) return res.status(400).json({success: false, error: `Too long (> ${maxChars})`});
    if (blockLinks && /\bhttps?:\/\//i.test(trimmed)) return res.status(400).json({success: false, error: "Links are not allowed"});
    const lowered = trimmed.toLowerCase();
    if (bannedWords.some((w) => w && lowered.includes(w.toLowerCase()))) return res.status(400).json({success: false, error: "Contains banned words"});

    // Enqueue into bot via Firestore-driven queue (bot already reads configs). Here, we cannot push directly to bot
    // Instead, return success; streamer can redeem in chat or we can later add a direct enqueue bridge.
    return res.json({success: true, status: "validated"});
  } catch (error) {
    console.error("[POST /api/rewards/tts:test] Error:", error);
    res.status(500).json({success: false, error: "Server error"});
  }
});
// Route: /api/obs/generateToken - Generate OBS WebSocket token
app.post("/api/obs/generateToken", authenticateApiRequest, async (req, res) => {
  const channelLogin = req.user.login;
  console.log(`[API /obs/generateToken] OBS token generation requested for ${channelLogin}`);

  if (!db || !secretManagerClient) {
    console.error("[API /obs/generateToken] Firestore or Secret Manager client not initialized!");
    return res.status(500).json({success: false, message: "Server configuration error."});
  }

  try {
    // Check if user has valid Twitch tokens
    try {
      await getValidTwitchTokenForUser(channelLogin);
      console.log(`[API /obs/generateToken] Verified valid Twitch token for ${channelLogin}`);
    } catch (tokenError) {
      console.error(`[API /obs/generateToken] Token validation failed for ${channelLogin}:`, tokenError.message);
      return res.status(403).json({
        success: false,
        needsReAuth: true,
        message: "Your Twitch authentication has expired. Please reconnect your account.",
      });
    }

    // Generate a secure token using crypto.randomUUID()
    const obsToken = crypto.randomUUID();
    const secretName = `obs-token-${channelLogin}`;
    const fullSecretName = `projects/${process.env.GCLOUD_PROJECT}/secrets/${secretName}`;

    console.log(`[API /obs/generateToken] Generated token for ${channelLogin}, creating secret: ${secretName}`);

    // Create or update the secret in Secret Manager
    try {
      // Try to create the secret first
      await secretManagerClient.createSecret({
        parent: `projects/${process.env.GCLOUD_PROJECT}`,
        secretId: secretName,
        secret: {
          replication: {automatic: {}},
        },
      });
      console.log(`[API /obs/generateToken] Created new secret: ${secretName}`);
    } catch (secretError) {
      if (secretError.code !== 6) { // 6 means "ALREADY_EXISTS"
        throw secretError;
      }
      console.log(`[API /obs/generateToken] Secret already exists: ${secretName}`);
    }

    // Add the token as a secret version
    await secretManagerClient.addSecretVersion({
      parent: fullSecretName,
      payload: {
        data: Buffer.from(obsToken, "utf8"),
      },
    });
    console.log(`[API /obs/generateToken] Added token version to secret: ${secretName}`);

    // Store the secret name in the TTS channel config in main app
    // We'll make a direct call to the function in the main TTS app
    try {
      // For now, we'll store it in the managedChannels collection as well
      // The main TTS app will need to read this and call setObsSocketSecretName
      const userDocRef = db.collection(CHANNELS_COLLECTION).doc(channelLogin);
      await userDocRef.update({
        obsTokenSecretName: `${fullSecretName}/versions/latest`,
        obsTokenGeneratedAt: FieldValue.serverTimestamp(),
      });
      console.log(`[API /obs/generateToken] Stored secret reference for ${channelLogin}`);
    } catch (dbError) {
      console.error(`[API /obs/generateToken] Error storing secret reference for ${channelLogin}:`, dbError);
      throw new Error("Failed to store OBS token reference");
    }

    // Generate the OBS Browser Source URL (HTTPS in prod; http in local via env)
    const obsWebSocketUrl = `${OBS_BROWSER_BASE_URL}/?channel=${channelLogin}&token=${obsToken}`;

    console.log(`[API /obs/generateToken] Successfully generated OBS token for ${channelLogin}`);

    res.json({
      success: true,
      obsWebSocketUrl: obsWebSocketUrl,
      token: obsToken,
      message: "OBS Browser Source URL generated successfully. This URL is persistent and won't expire.",
    });
  } catch (error) {
    console.error(`[API /obs/generateToken] Error generating OBS token for ${channelLogin}:`, error);
    res.status(500).json({
      success: false,
      message: "Failed to generate OBS token: " + error.message,
    });
  }
});

exports.webUi = functions.https.onRequest(app); // Updated with OBS token generation
