/**
 * Authentication routes for Twitch OAuth
 */

import express, {Request, Response, Router} from "express";
import {randomBytes} from "crypto";
import axios from "axios";
import jwt from "jsonwebtoken";
import {secrets, config, secretManagerClient} from "../config";
import {db, COLLECTIONS} from "../services/firestore";
import {validateTwitchToken} from "../services/twitch";
import {logger, redactSensitive} from "../logger";

const router: Router = express.Router();

// Twitch API endpoints
const TWITCH_AUTH_URL = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";

// OAuth tier definitions
const OAUTH_TIERS = {
  anonymous: "user:read:email channel:read:redemptions channel:manage:redemptions",
  full: "user:read:email chat:read chat:edit channel:read:subscriptions bits:read moderator:read:followers channel:manage:redemptions channel:read:redemptions channel:manage:moderators",
} as const;

type OAuthTier = keyof typeof OAUTH_TIERS;

// Type definitions
interface TwitchTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string[] | string;
  token_type: string;
}

interface TwitchValidateResponse {
  client_id: string;
  login: string;
  scopes: string[];
  user_id: string;
  expires_in: number;
}

interface TwitchUserData {
  id: string;
  login: string;
  display_name: string;
  email?: string;
}

interface TwitchUsersResponse {
  data: TwitchUserData[];
}

interface ViewerStatePayload {
  t: string; // type
  r?: string; // random
  c?: string; // channel
  channel?: string;
}

/**
 * Helper function to redirect to frontend with error
 * @param res - Express response object
 * @param errorCode - Error code
 * @param errorDescription - Error description
 * @param state - OAuth state parameter
 * @return Express redirect response
 */
function redirectToFrontendWithError(res: Response, errorCode: string, errorDescription: string, state: string | undefined): void {
  if (!config.FRONTEND_URL) {
    logger.error("FRONTEND_URL not configured");
    res.status(500).send("Server configuration error");
    return;
  }

  const frontendErrorUrl = new URL(config.FRONTEND_URL);
  frontendErrorUrl.pathname = "/auth-error.html";
  frontendErrorUrl.searchParams.append("error", errorCode);
  frontendErrorUrl.searchParams.append("error_description", errorDescription);
  if (state) frontendErrorUrl.searchParams.append("state", state);

  logger.info({errorCode, errorDescription}, "Redirecting to frontend error page");
  res.redirect(frontendErrorUrl.toString());
}

/**
 * Helper function to handle viewer OAuth callback
 * @param req - Express request object
 * @param res - Express response object
 * @param decodedState - Decoded OAuth state
 * @return JSON response
 */
async function handleViewerCallback(req: Request, res: Response, decodedState: ViewerStatePayload | null): Promise<Response> {
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
    const tokenResponse = await axios.post<TwitchTokenResponse>(TWITCH_TOKEN_URL, null, {
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

    if (!config.FRONTEND_URL) {
      throw new Error("FRONTEND_URL not configured");
    }

    // Redirect viewers back to the preferences page with a validated session token
    const redirectUrl = new URL(config.FRONTEND_URL);
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
  } catch (error) {
    const err = error as Error;
    logger.error({error: err.message}, "Viewer OAuth callback error");
    return res.status(500).json({
      success: false,
      error: "auth_failed",
      error_description: "Failed to complete viewer authentication",
    });
  }
}

// Route: /auth/twitch/initiate
router.get("/twitch/initiate", (req: Request, res: Response): void => {
  logger.info("--- /auth/twitch/initiate HIT --- Version 1.2 ---");

  if (!secrets.TWITCH_CLIENT_ID || !config.CALLBACK_URL) {
    logger.error("Config missing for /auth/twitch/initiate: TWITCH_CLIENT_ID or CALLBACK_URL not found.");
    res.status(500).json({success: false, error: "Server configuration error for Twitch auth."});
    return;
  }

  // Determine OAuth tier from query parameter (default to 'full' for backward compatibility)
  const tier = (req.query.tier as OAuthTier) || "full";
  const scope = OAUTH_TIERS[tier] || OAUTH_TIERS.full;

  const state = randomBytes(16).toString("hex");

  const params = new URLSearchParams({
    client_id: secrets.TWITCH_CLIENT_ID,
    redirect_uri: config.CALLBACK_URL,
    response_type: "code",
    scope: scope,
    state: state,
    force_verify: "true",
  });
  const twitchAuthUrl = `${TWITCH_AUTH_URL}?${params.toString()}`;

  logger.info({state, tier, scope}, "Generated state with OAuth tier");
  logger.debug({twitchAuthUrl}, "Twitch Auth URL to be sent to frontend");

  res.json({
    success: true,
    twitchAuthUrl: twitchAuthUrl,
    state: state,
    tier: tier,
  });
});

// Route: /auth/twitch/callback
router.get("/twitch/callback", async (req: Request, res: Response): Promise<void | Response> => {
  logger.info("--- /auth/twitch/callback HIT ---");
  logger.debug({query: redactSensitive(req.query)}, "Callback Request Query Params");
  const {code, state: twitchQueryState, error: twitchError, error_description: twitchErrorDescription} = req.query;

  // Try to decode state parameter to detect viewer auth
  let isViewerAuth = false;
  let decodedState: ViewerStatePayload | null = null;
  try {
    if (typeof twitchQueryState === "string") {
      decodedState = JSON.parse(Buffer.from(twitchQueryState, "base64").toString()) as ViewerStatePayload;
      if (decodedState && decodedState.t === "viewer") {
        isViewerAuth = true;
        logger.info("Detected viewer auth from state parameter");
      }
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
    return redirectToFrontendWithError(res, twitchError as string, twitchErrorDescription as string, twitchQueryState as string);
  }

  try {
    logger.debug({callbackUrl: config.CALLBACK_URL}, "Exchanging code for token");
    const tokenResponse = await axios.post<TwitchTokenResponse>(TWITCH_TOKEN_URL, null, {
      params: {
        client_id: secrets.TWITCH_CLIENT_ID,
        client_secret: secrets.TWITCH_CLIENT_SECRET,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: config.CALLBACK_URL,
      },
    });

    const {access_token: accessToken, refresh_token: refreshToken, scope: grantedScopes} = tokenResponse.data;
    logger.info("Access token and refresh token received from Twitch.");

    if (!accessToken || !refreshToken) {
      logger.error({responseData: redactSensitive(tokenResponse.data)}, "Missing access_token or refresh_token from Twitch");
      throw new Error("Twitch did not return the expected tokens.");
    }

    // Determine OAuth tier based on granted scopes
    const scopeArray = Array.isArray(grantedScopes) ? grantedScopes : (grantedScopes || "").split(" ");
    const hasModeratorScope = scopeArray.includes("channel:manage:moderators");
    const oauthTier: OAuthTier = hasModeratorScope ? "full" : "anonymous";
    logger.info({oauthTier, grantedScopes: scopeArray}, "Determined OAuth tier from granted scopes");

    const validateResponse = await axios.get<TwitchValidateResponse>(TWITCH_VALIDATE_URL, {
      headers: {Authorization: `OAuth ${accessToken}`},
    });

    if (validateResponse.data && validateResponse.data.user_id) {
      // Fetch user details including email
      const userResponse = await axios.get<TwitchUsersResponse>("https://api.twitch.tv/helix/users", {
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

      if (!config.FRONTEND_URL) {
        throw new Error("FRONTEND_URL not configured");
      }

      const frontendAuthCompleteUrl = new URL(config.FRONTEND_URL);
      frontendAuthCompleteUrl.pathname = "/auth-complete.html";
      frontendAuthCompleteUrl.searchParams.append("user_login", twitchUser.login);
      frontendAuthCompleteUrl.searchParams.append("user_id", twitchUser.id);
      frontendAuthCompleteUrl.searchParams.append("state", twitchQueryState as string);
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
            const err = createError as Error;
            if (!err.message.includes("already exists")) {
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
            const err = createError as Error;
            if (!err.message.includes("already exists")) {
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
            oauthTier: oauthTier,
            grantedScopes: scopeArray,
          }, {merge: true});

          // Sync botMode in ttsChannelConfigs for the TTS bot service
          // Map oauthTier to botMode: 'anonymous' → 'anonymous', 'full' → 'authenticated'
          const botMode = oauthTier === 'anonymous' ? 'anonymous' : 'authenticated';
          const ttsConfigDocRef = db.collection('ttsChannelConfigs').doc(twitchUser.login);
          await ttsConfigDocRef.set({
            botMode: botMode,
          }, {merge: true});
          logger.info({userLogin: twitchUser.login, botMode, oauthTier}, "Synced botMode to ttsChannelConfigs");

          logger.info({userLogin: twitchUser.login}, "Secret reference stored in Firestore");
        } catch (dbError) {
          const err = dbError as Error;
          logger.error({userLogin: twitchUser.login, error: err.message}, "Error storing secret");
          return redirectToFrontendWithError(res, "token_store_failed", "Failed to securely store Twitch credentials. Please try again.", twitchQueryState as string);
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
        const err = eventSubError as Error;
        logger.error({userLogin: twitchUser.login, error: err.message}, "[AuthCallback] Error setting up EventSub");
        // Don't fail the auth process if EventSub setup fails
      }

      return res.redirect(frontendAuthCompleteUrl.toString());
    } else {
      logger.error("Failed to validate token or get user info from Twitch after token exchange.");
      throw new Error("Failed to validate token or get user info from Twitch.");
    }
  } catch (error) {
    const err = error as {message: string; response?: {data: unknown}; stack?: string};
    logger.error({
      error: err.message,
      responseData: redactSensitive(err.response?.data),
      stack: err.stack,
    }, "[AuthCallback] Twitch OAuth callback error");
    return redirectToFrontendWithError(res, "auth_failed", err.message || "Authentication failed with Twitch due to an internal server error.", twitchQueryState as string);
  }
});

// Route: /auth/twitch/viewer
router.get("/twitch/viewer", (req: Request, res: Response): void => {
  logger.info("--- /auth/twitch/viewer HIT ---");

  if (!secrets.TWITCH_CLIENT_ID || !config.CALLBACK_URL) {
    logger.error("Config missing: TWITCH_CLIENT_ID or CALLBACK_URL not found.");
    res.status(500).json({success: false, error: "Server configuration error for Twitch viewer auth."});
    return;
  }

  // Create state parameter with viewer type marker
  const {channel} = req.query || {};
  const statePayload: ViewerStatePayload = {
    t: "viewer", // type: viewer
    r: randomBytes(8).toString("hex"), // random component
    c: (channel as string) || undefined, // optional channel context
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
router.get("/logout", (_req: Request, res: Response): void => {
  logger.info("--- /auth/logout HIT ---");
  res.json({success: true, message: "Logout successful. Please clear your session token on the client side."});
});


export default router;
