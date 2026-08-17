/**
 * Authentication routes for Twitch OAuth
 */

import express, { Request, Response, Router } from "express";
import axios from "axios";
import jwt from "jsonwebtoken";
import { secrets, config } from "../config";
import { db, COLLECTIONS, FieldValue } from "../services/firestore";
import { validateTwitchToken } from "../services/twitch";
import { logger, redactSensitive } from "../logger";
import { issueState, consumeState, OAuthStatePayload } from "./state";
import { createExchangeCode, redeemExchangeCode, EXCHANGE_CODE_PATTERN } from "./exchange";

const router: Router = express.Router();

// Twitch API endpoints
const TWITCH_AUTH_URL = "https://id.twitch.tv/oauth2/authorize";
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";

// OAuth scopes for streamer authentication
// EventSub webhooks use an App Access Token. Twitch strictly requires the broadcaster
// to grant the `channel:bot` scope for `channel.chat.message` subscriptions
// if the bot is not explicitly a moderator in the channel.
const OAUTH_SCOPES = "user:read:email channel:read:subscriptions bits:read moderator:read:followers channel:manage:redemptions channel:read:redemptions channel:manage:moderators channel:bot";

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

  logger.info({ errorCode, errorDescription }, "Redirecting to frontend error page");
  res.redirect(frontendErrorUrl.toString());
}

/**
 * Helper function to handle viewer OAuth callback
 * @param req - Express request object
 * @param res - Express response object
 * @param statePayload - Routing context recovered from the state cookie
 * @return JSON response
 */
async function handleViewerCallback(req: Request, res: Response, statePayload: OAuthStatePayload): Promise<Response> {
  logger.info("Handling viewer OAuth callback");
  const { code, error: twitchError, error_description: twitchErrorDescription } = req.query;

  if (twitchError) {
    logger.error({ twitchError, twitchErrorDescription }, "Viewer OAuth error");
    // Viewer failures land on the same error page as broadcaster failures, so
    // there is one place that renders a Twitch failure and one Try again path.
    redirectToFrontendWithError(
      res,
      twitchError as string,
      twitchErrorDescription as string,
      req.query.state as string | undefined,
    );
    return res;
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

    const { access_token: accessToken } = tokenResponse.data;
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
      issuer: "wildcat-tts-auth",
      audience: "wildcat-tts-api",
    });

    logger.info({ userLogin }, "Generated viewer session token");

    if (!config.FRONTEND_URL) {
      throw new Error("FRONTEND_URL not configured");
    }

    if (!db) {
      throw new Error("Firestore not initialised — cannot mint an exchange code");
    }

    // The redirect carries a single-use code, not the token. The token itself
    // would otherwise sit in browser history and in the Referer of anything
    // the preferences page loads.
    const exchangeCode = await createExchangeCode(db, viewerSessionToken);

    const redirectUrl = new URL(config.FRONTEND_URL);
    redirectUrl.pathname = "/viewer-settings.html";
    redirectUrl.searchParams.set("code", exchangeCode);
    redirectUrl.searchParams.set("validated", "1");
    // Preserve optional channel context if the initiating request carried one
    if (statePayload.c) {
      redirectUrl.searchParams.set("channel", statePayload.c);
    }

    res.redirect(redirectUrl.toString());
    return res;
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message }, "Viewer OAuth callback error");
    redirectToFrontendWithError(
      res,
      "auth_failed",
      "Could not finish signing you in for viewer preferences. Please try again.",
      req.query.state as string | undefined,
    );
    return res;
  }
}

/**
 * Mints the state cookie and builds the Twitch authorization URL to send the
 * browser to. Shared by every entry point so the broadcaster and viewer flows
 * cannot drift apart.
 * @param res - Express response object, for the state cookie
 * @param payload - Routing context to recover on the callback
 * @param scope - Space-separated Twitch scopes; empty for the viewer flow
 * @return The Twitch authorization URL
 */
function buildTwitchAuthUrl(res: Response, payload: OAuthStatePayload, scope: string): string {
  const state = issueState(res, payload);

  const params = new URLSearchParams({
    client_id: secrets.TWITCH_CLIENT_ID,
    redirect_uri: config.CALLBACK_URL as string,
    response_type: "code",
    scope,
    state,
    force_verify: "true",
  });

  return `${TWITCH_AUTH_URL}?${params.toString()}`;
}

/**
 * Reports missing OAuth configuration the same way for every entry point.
 * @param res - Express response object
 * @return True when the request cannot proceed
 */
function oauthConfigMissing(res: Response): boolean {
  if (secrets.TWITCH_CLIENT_ID && config.CALLBACK_URL) return false;

  logger.error("Config missing: TWITCH_CLIENT_ID or CALLBACK_URL not found.");
  redirectToFrontendWithError(
    res,
    "server_error",
    "Sign-in is not configured correctly right now. Please try again later.",
    undefined,
  );
  return true;
}

// Route: /auth/twitch — broadcaster sign-in
// The server owns the whole flow: no round trip, nothing for the page to hold.
router.get("/twitch", (_req: Request, res: Response): void => {
  logger.info("--- /auth/twitch HIT ---");
  if (oauthConfigMissing(res)) return;

  res.redirect(buildTwitchAuthUrl(res, { t: "broadcaster" }, OAUTH_SCOPES));
});

// Route: /auth/twitch/callback
router.get("/twitch/callback", async (req: Request, res: Response): Promise<void | Response> => {
  logger.info("--- /auth/twitch/callback HIT ---");
  logger.debug({ query: redactSensitive(req.query) }, "Callback Request Query Params");
  const { code, state: twitchQueryState, error: twitchError, error_description: twitchErrorDescription } = req.query;

  // Bind this callback to the browser that started the flow, before the
  // authorization code is exchanged and before any token is minted. The cookie
  // is consumed and cleared here on every path, so a state cannot be replayed.
  const stateResult = consumeState(req, res);

  if (!stateResult.ok) {
    // A genuine Twitch error is the more useful thing to report, and that flow
    // was never going to succeed anyway.
    if (twitchError) {
      logger.error({ twitchError, twitchErrorDescription, reason: stateResult.reason }, "Twitch OAuth error on an unbound callback");
      return redirectToFrontendWithError(res, twitchError as string, twitchErrorDescription as string, twitchQueryState as string);
    }

    logger.error({ reason: stateResult.reason }, "OAuth state binding failed — rejecting callback");
    return redirectToFrontendWithError(
      res,
      "invalid_state",
      "Could not verify that this login started in your browser. Please try logging in again from the main page.",
      twitchQueryState as string,
    );
  }

  if (stateResult.payload.t === "viewer") {
    logger.info("Detected viewer OAuth callback, delegating to viewer handler");
    return handleViewerCallback(req, res, stateResult.payload);
  }

  if (twitchError) {
    logger.error({ twitchError, twitchErrorDescription }, "Twitch OAuth explicit error");
    return redirectToFrontendWithError(res, twitchError as string, twitchErrorDescription as string, twitchQueryState as string);
  }

  try {
    logger.debug({ callbackUrl: config.CALLBACK_URL }, "Exchanging code for token");
    const tokenResponse = await axios.post<TwitchTokenResponse>(TWITCH_TOKEN_URL, null, {
      params: {
        client_id: secrets.TWITCH_CLIENT_ID,
        client_secret: secrets.TWITCH_CLIENT_SECRET,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: config.CALLBACK_URL,
      },
    });

    const { access_token: accessToken, refresh_token: refreshToken, scope: grantedScopes } = tokenResponse.data;
    logger.info("Access token and refresh token received from Twitch.");

    if (!accessToken || !refreshToken) {
      logger.error({ responseData: redactSensitive(tokenResponse.data) }, "Missing access_token or refresh_token from Twitch");
      throw new Error("Twitch did not return the expected tokens.");
    }

    // Log granted scopes for debugging
    const scopeArray = Array.isArray(grantedScopes) ? grantedScopes : (grantedScopes || "").split(" ");
    logger.info({ grantedScopes: scopeArray }, "Received granted scopes from Twitch");

    const validateResponse = await axios.get<TwitchValidateResponse>(TWITCH_VALIDATE_URL, {
      headers: { Authorization: `OAuth ${accessToken}` },
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
      logger.info({ userLogin: twitchUser.login }, "[AuthCallback] User authenticated and validated");

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
        issuer: "wildcat-tts-auth",
        audience: "wildcat-tts-api",
      });
      logger.info({ userLogin: twitchUser.login }, "Generated app session token");

      if (!config.FRONTEND_URL) {
        throw new Error("FRONTEND_URL not configured");
      }

      const frontendAuthCompleteUrl = new URL(config.FRONTEND_URL);
      frontendAuthCompleteUrl.pathname = "/auth-complete.html";
      frontendAuthCompleteUrl.searchParams.append("user_login", twitchUser.login);
      frontendAuthCompleteUrl.searchParams.append("user_id", twitchUser.id);
      frontendAuthCompleteUrl.searchParams.append("state", twitchQueryState as string);

      // A single-use code stands in for the token, which would otherwise sit in
      // browser history and in the Referer of anything auth-complete.html loads.
      if (!db) {
        throw new Error("Firestore not initialised — cannot mint an exchange code");
      }
      frontendAuthCompleteUrl.searchParams.append(
        "code",
        await createExchangeCode(db, appSessionToken),
      );

      logger.info({ userLogin: twitchUser.login }, "Redirecting to frontend auth-complete page");

      // Store tokens securely
      if (db) {
        const userDocRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(twitchUser.id);

        // Allow-list gate: only pre-approved channels (admin-created docs) can log in.
        const existingDoc = await userDocRef.get();
        if (!existingDoc.exists) {
          logger.warn({ userLogin: twitchUser.login, userId: twitchUser.id },
            "Channel not approved — no managedChannels document");
          return redirectToFrontendWithError(res,
            "not_authorized",
            "Your channel is not authorized to use this bot.",
            twitchQueryState as string);
        }

        try {
          // Store OAuth tokens in Firestore (not Secret Manager)
          const oauthDocRef = db.collection("users").doc(twitchUser.id).collection("private").doc("oauth");
          await oauthDocRef.set({
            twitchAccessToken: accessToken,
            twitchRefreshToken: refreshToken,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });

          // Update (never create) the approved channel's metadata
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
            grantedScopes: scopeArray,
          }, { merge: true });

          // Sync botRespondsInChat in ttsChannelConfigs for the TTS bot service
          // Default to true (bot responds to commands in chat)
          const ttsConfigDocRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(twitchUser.id);
          await ttsConfigDocRef.set({
            botRespondsInChat: true,
          }, { merge: true });
          logger.info({ userLogin: twitchUser.login, botRespondsInChat: true }, "Synced botRespondsInChat to ttsChannelConfigs");

          logger.info({ userLogin: twitchUser.login }, "Secret reference stored in Firestore");
        } catch (dbError) {
          const err = dbError as Error;
          logger.error({ userLogin: twitchUser.login, error: err.message }, "Error storing secret");
          return redirectToFrontendWithError(res, "token_store_failed", "Failed to securely store Twitch credentials. Please try again.", twitchQueryState as string);
        }
      } else {
        logger.error("Firestore (db) or SecretManagerServiceClient not initialized. Cannot store Twitch tokens.");
      }

      // Auto-mod: add the bot as a moderator in the broadcaster's channel.
      // This ensures the bot can send chat messages without needing `channel:bot`
      // and appears in the channel's mod list immediately after onboarding.
      try {
        const botUsername = config.TWITCH_BOT_USERNAME;
        if (botUsername && accessToken) {
          // Resolve bot login → user ID
          const botLookup = await axios.get<TwitchUsersResponse>(
            `https://api.twitch.tv/helix/users?login=${botUsername}`, {
              headers: {
                "Authorization": `Bearer ${accessToken}`,
                "Client-Id": secrets.TWITCH_CLIENT_ID,
              },
            },
          );
          const botUserId = botLookup.data.data[0]?.id;
          if (botUserId) {
            await axios.post(
              `https://api.twitch.tv/helix/moderation/moderators?broadcaster_id=${twitchUser.id}&user_id=${botUserId}`,
              null,
              {
                headers: {
                  "Authorization": `Bearer ${accessToken}`,
                  "Client-Id": secrets.TWITCH_CLIENT_ID,
                },
                timeout: 10000,
              },
            );
            logger.info({ userLogin: twitchUser.login, botUsername, botUserId },
              "[AuthCallback] Bot added as moderator in channel");
          } else {
            logger.warn({ botUsername }, "[AuthCallback] Could not resolve bot user ID — skipping auto-mod");
          }
        }
      } catch (modError) {
        // 422 = already a mod, which is fine. Any other error is best-effort.
        const mErr = modError as { message: string; response?: { status?: number; data?: unknown } };
        if (mErr.response?.status === 422) {
          logger.info({ userLogin: twitchUser.login }, "[AuthCallback] Bot is already a moderator in channel");
        } else {
          logger.warn({
            userLogin: twitchUser.login,
            error: mErr.message,
            status: mErr.response?.status,
          }, "[AuthCallback] Failed to auto-mod bot (best-effort)");
        }
      }

      // Explicitly trigger EventSub subscription setup on the TTS backend.
      // We cannot rely solely on the Firestore listener because Cloud Run may
      // be scaled to zero when the user authenticates, meaning no listener is
      // running to react to the document change.
      try {
        const ttsBotUrl = config.TTS_BOT_URL;
        if (ttsBotUrl) {
          logger.info({ userLogin: twitchUser.login, ttsBotUrl }, "[AuthCallback] Calling TTS backend to set up EventSub subscriptions");
          // The endpoint requires a session token whose userLogin matches
          // channelLogin; it resolves the Twitch user ID itself.
          const eventSubResponse = await axios.post(`${ttsBotUrl}/api/setup-eventsub`, {
            channelLogin: twitchUser.login,
          }, {
            timeout: 15000,
            headers: { Authorization: `Bearer ${appSessionToken}` },
          });
          logger.info({
            userLogin: twitchUser.login,
            successful: eventSubResponse.data?.successful?.length ?? 0,
            failed: eventSubResponse.data?.failed?.length ?? 0,
          }, "[AuthCallback] EventSub setup completed via TTS backend");
        } else {
          logger.warn("[AuthCallback] TTS_BOT_URL not configured — skipping explicit EventSub setup");
        }
      } catch (eventSubError) {
        // Best-effort: don't block the auth flow if EventSub setup fails.
        // The Firestore listener will eventually pick it up when the backend is running.
        const esErr = eventSubError as { message: string; response?: { data?: unknown } };
        logger.warn({
          userLogin: twitchUser.login,
          error: esErr.message,
          responseData: esErr.response?.data,
        }, "[AuthCallback] EventSub setup call failed (best-effort) — Firestore listener will retry");
      }

      return res.redirect(frontendAuthCompleteUrl.toString());
    } else {
      logger.error("Failed to validate token or get user info from Twitch after token exchange.");
      throw new Error("Failed to validate token or get user info from Twitch.");
    }
  } catch (error) {
    const err = error as { message: string; response?: { data: unknown }; stack?: string };
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
  if (oauthConfigMissing(res)) return;

  // The viewer marker and channel context go in the cookie, not in `state`.
  // `t` decides which callback handler runs and therefore which token scope is
  // issued, so it must not be readable back out of an attacker-supplied value.
  const { channel } = req.query || {};

  // No scopes: this flow only establishes who the viewer is.
  res.redirect(buildTwitchAuthUrl(res, {
    t: "viewer",
    c: (channel as string) || undefined,
  }, ""));
});

// Route: /auth/exchange
// Trades the single-use code from the callback redirect for the session token.
//
// Unauthenticated by necessity — this is how a session is obtained in the first
// place. Its only credential is the code, which is high-entropy, one-minute,
// single-use, and stored only as a hash.
router.post("/exchange", async (req: Request, res: Response): Promise<void> => {
  const { code } = req.body ?? {};

  // Shape-check before hashing and hitting Firestore.
  if (typeof code !== "string" || !EXCHANGE_CODE_PATTERN.test(code)) {
    res.status(400).json({ success: false, error: "Missing or malformed exchange code" });
    return;
  }

  if (!db) {
    logger.error("Firestore not initialised — cannot redeem an exchange code");
    res.status(500).json({ success: false, error: "Could not complete sign-in. Please try again." });
    return;
  }

  try {
    const result = await redeemExchangeCode(db, code);

    if (!result.ok) {
      logger.warn({ reason: result.reason }, "Exchange code refused");
      res.status(400).json({
        success: false,
        error: "This sign-in link has already been used or has expired. Please sign in again.",
      });
      return;
    }

    logger.info("Exchange code redeemed");
    res.json({ success: true, session_token: result.sessionToken });
  } catch (error) {
    logger.error({ error: (error as Error).message }, "Exchange code redemption failed");
    res.status(500).json({ success: false, error: "Could not complete sign-in. Please try again." });
  }
});

// Route: /auth/logout
router.get("/logout", (_req: Request, res: Response): void => {
  logger.info("--- /auth/logout HIT ---");
  res.json({ success: true, message: "Logout successful. Please clear your session token on the client side." });
});


export default router;
