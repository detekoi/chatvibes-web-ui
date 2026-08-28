/**
 * OBS integration API routes
 */

import express, {Request, Response, Router} from "express";
import {randomBytes} from "crypto";
import {db, FieldValue, COLLECTIONS} from "../services/firestore";
import {getValidTwitchTokenForUser} from "../services/twitch";
import {authenticateApiRequest, assertAuthenticated} from "../middleware/auth";
import {secrets, config} from "../config";
import {logger} from "../logger";
import {apiError} from "./utils";

/**
 * An OBS failure.
 *
 * These endpoints have always put their prose in `message` rather than `error`,
 * so both carry it: `code` is what a localized client reads, `error` is the
 * shape every other endpoint uses, and `message` is the field this route's
 * existing callers already look at.
 */
function fail(
  res: Response,
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  apiError(res, status, code, message, undefined, {...extra, message});
}

const router: Router = express.Router();

// Route: /api/obs/getToken
router.get("/getToken", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  assertAuthenticated(req);

  const channelLogin = req.user.userLogin;
  const log = logger.child({endpoint: "/api/obs/getToken", channelLogin});
  log.info("OBS token retrieval requested");

  if (!db) {
    log.error("Firestore client not initialized!");
    fail(res, 500, "server_misconfigured", "Server configuration error.");
    return;
  }

  try {
    // Check if user has valid Twitch tokens
    try {
      await getValidTwitchTokenForUser(req.user.userId, secrets);
      log.debug("Verified valid Twitch token");
    } catch (tokenError) {
      const err = tokenError as Error;
      log.error({error: err.message}, "Token validation failed");
      fail(res, 403, "twitch_reauth_required",
        "Your Twitch authentication has expired. Please reconnect your account.",
        {needsReAuth: true});
      return;
    }

    // Try to read existing OBS token from Firestore
    const ttsDocRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
    const ttsDoc = await ttsDocRef.get();
    const ttsData = ttsDoc.exists ? ttsDoc.data() : null;

    // Check if token exists in Firestore
    if (ttsData?.obsSocketToken) {
      log.info("Retrieved existing OBS token from Firestore");
      res.json({
        success: true,
        token: ttsData.obsSocketToken,
        browserSourceUrl: `${config.OBS_BROWSER_BASE_URL}/?channel=${encodeURIComponent(channelLogin)}&token=${ttsData.obsSocketToken}`,
      });
      return;
    }

    // Generate new OBS token and store in Firestore
    const obsToken = randomBytes(32).toString("hex");
    log.info("Generating new OBS token");

    try {
      // Store token directly in Firestore
      await ttsDocRef.set({
        obsSocketToken: obsToken,
        obsTokenGeneratedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});

      log.info("Generated new OBS token and stored in Firestore");

      res.json({
        success: true,
        token: obsToken,
        browserSourceUrl: `${config.OBS_BROWSER_BASE_URL}/?channel=${encodeURIComponent(channelLogin)}&token=${obsToken}`,
      });
    } catch (error) {
      const err = error as Error;
      log.error({error: err.message}, "Failed to store OBS token");
      fail(res, 500, "obs_token_store_failed", "Failed to generate OBS token. Please try again.");
    }
  } catch (error) {
    const err = error as Error;
    log.error({error: err.message}, "Error retrieving OBS token");
    fail(res, 500, "obs_token_fetch_failed", "Failed to retrieve OBS token.");
  }
});

// Route: /api/obs/generateToken
router.post("/generateToken", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  assertAuthenticated(req);

  const channelLogin = req.user.userLogin;
  const log = logger.child({endpoint: "/api/obs/generateToken", channelLogin});
  log.info("OBS token generation requested");

  if (!db) {
    log.error("Firestore client not initialized!");
    fail(res, 500, "server_misconfigured", "Server configuration error.");
    return;
  }

  try {
    // Verify valid Twitch token
    try {
      await getValidTwitchTokenForUser(req.user.userId, secrets);
    } catch (tokenError) {
      fail(res, 403, "twitch_reauth_required",
        "Your Twitch authentication has expired. Please reconnect your account.",
        {needsReAuth: true});
      return;
    }

    // Generate new OBS token
    const obsToken = randomBytes(32).toString("hex");

    // Store token directly in Firestore
    const ttsDocRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userId);
    await ttsDocRef.set({
      obsSocketToken: obsToken,
      obsTokenGeneratedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    log.info("Generated new OBS token and stored in Firestore");

    res.json({
      success: true,
      token: obsToken,
      browserSourceUrl: `${config.OBS_BROWSER_BASE_URL}/?channel=${encodeURIComponent(channelLogin)}&token=${obsToken}`,
      message: "New OBS token generated successfully",
    });
  } catch (error) {
    const err = error as Error;
    log.error({error: err.message}, "Error generating OBS token");
    fail(res, 500, "obs_token_generate_failed", "Failed to generate new OBS token.");
  }
});

export default router;
