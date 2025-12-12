/**
 * OBS integration API routes
 */

import express, {Request, Response, Router} from "express";
import {randomBytes} from "crypto";
import {db, FieldValue, COLLECTIONS} from "../services/firestore";
import {getValidTwitchTokenForUser} from "../services/twitch";
import {authenticateApiRequest} from "../middleware/auth";
import {secrets, config} from "../config";
import {logger} from "../logger";

const router: Router = express.Router();

// Route: /api/obs/getToken
router.get("/getToken", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({success: false, message: "Unauthorized"});
    return;
  }

  const channelLogin = req.user.userLogin;
  const log = logger.child({endpoint: "/api/obs/getToken", channelLogin});
  log.info("OBS token retrieval requested");

  if (!db) {
    log.error("Firestore client not initialized!");
    res.status(500).json({success: false, message: "Server configuration error."});
    return;
  }

  try {
    // Check if user has valid Twitch tokens
    try {
      await getValidTwitchTokenForUser(channelLogin, secrets);
      log.debug("Verified valid Twitch token");
    } catch (tokenError) {
      const err = tokenError as Error;
      log.error({error: err.message}, "Token validation failed");
      res.status(403).json({
        success: false,
        needsReAuth: true,
        message: "Your Twitch authentication has expired. Please reconnect your account.",
      });
      return;
    }

    // Try to read existing OBS token from Firestore
    const ttsDocRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelLogin);
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
      res.status(500).json({
        success: false,
        message: "Failed to generate OBS token. Please try again.",
      });
    }
  } catch (error) {
    const err = error as Error;
    log.error({error: err.message}, "Error retrieving OBS token");
    res.status(500).json({
      success: false,
      message: "Failed to retrieve OBS token.",
    });
  }
});

// Route: /api/obs/generateToken
router.post("/generateToken", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({success: false, message: "Unauthorized"});
    return;
  }

  const channelLogin = req.user.userLogin;
  const log = logger.child({endpoint: "/api/obs/generateToken", channelLogin});
  log.info("OBS token generation requested");

  if (!db) {
    log.error("Firestore client not initialized!");
    res.status(500).json({success: false, message: "Server configuration error."});
    return;
  }

  try {
    // Verify valid Twitch token
    try {
      await getValidTwitchTokenForUser(channelLogin, secrets);
    } catch (tokenError) {
      res.status(403).json({
        success: false,
        needsReAuth: true,
        message: "Your Twitch authentication has expired. Please reconnect your account.",
      });
      return;
    }

    // Generate new OBS token
    const obsToken = randomBytes(32).toString("hex");

    // Store token directly in Firestore
    const ttsDocRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelLogin);
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
    res.status(500).json({
      success: false,
      message: "Failed to generate new OBS token.",
    });
  }
});

export default router;
