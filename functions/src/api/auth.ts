/**
 * Authentication API routes for status and token management
 */

import express, {Request, Response, Router} from "express";
import {db, COLLECTIONS} from "../services/firestore";
import {getValidTwitchTokenForUser} from "../services/twitch";
import {authenticateApiRequest} from "../middleware/auth";
import {secrets} from "../config";
import {logger} from "../logger";

const router: Router = express.Router();

// Route: /api/auth/status
router.get("/status", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  const log = logger.child({endpoint: "/api/auth/status", userLogin: req.user?.userLogin});
  log.info("--- /api/auth/status HIT ---");
  log.debug({user: req.user}, "Authenticated user from middleware");

  try {
    if (!req.user) {
      res.status(401).json({success: false, error: "Unauthorized"});
      return;
    }

    const userDocRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(req.user.userLogin);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      log.warn({userLogin: req.user.userLogin}, "User not found in managed channels");
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
      res.status(500).json({success: false, error: "User data not found"});
      return;
    }

    const {needsTwitchReAuth, twitchAccessTokenExpiresAt} = userData;

    let twitchTokenStatus = "valid";
    if (needsTwitchReAuth) {
      twitchTokenStatus = "needs_reauth";
    } else if (twitchAccessTokenExpiresAt) {
      const expiresAt = twitchAccessTokenExpiresAt.toDate();
      const now = new Date();
      if (expiresAt <= now) {
        twitchTokenStatus = "expired";
      }
    }

    log.info({userLogin: req.user.userLogin, twitchTokenStatus}, "User auth status");

    res.json({
      success: true,
      user: req.user,
      twitchTokenStatus: twitchTokenStatus,
      needsTwitchReAuth: needsTwitchReAuth || false,
    });
  } catch (error) {
    const err = error as Error;
    logger.error({error: err.message}, "Error checking auth status");
    res.status(500).json({
      success: false,
      error: "Failed to check authentication status",
    });
  }
});

// Route: /api/auth/refresh
router.post("/refresh", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  const log = logger.child({endpoint: "/api/auth/refresh", userLogin: req.user?.userLogin});
  log.info("--- /api/auth/refresh HIT ---");

  try {
    if (!req.user) {
      res.status(401).json({success: false, error: "Unauthorized"});
      return;
    }

    // This will automatically refresh the token if needed
    await getValidTwitchTokenForUser(req.user.userLogin, secrets);

    log.info("Token refresh successful");
    res.json({
      success: true,
      message: "Token refreshed successfully",
    });
  } catch (error) {
    const err = error as Error;
    log.error({error: err.message}, "Token refresh failed");
    res.status(400).json({
      success: false,
      error: err.message,
      needsReauth: err.message.includes("re-authenticate"),
    });
  }
});

// Route: /api/auth/update-tier
router.post("/update-tier", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  const log = logger.child({endpoint: "/api/auth/update-tier", userLogin: req.user?.userLogin});
  log.info("--- /api/auth/update-tier HIT ---");

  try {
    if (!req.user) {
      res.status(401).json({success: false, error: "Unauthorized"});
      return;
    }

    const {tier} = req.body;
    if (!tier || (tier !== 'anonymous' && tier !== 'full')) {
      res.status(400).json({success: false, message: "Invalid tier. Must be 'anonymous' or 'full'."});
      return;
    }

    // Note: Downgrading from 'full' to 'anonymous' is allowed
    // Upgrading from 'anonymous' to 'full' requires re-authentication with more scopes

    const userDocRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(req.user.userLogin);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      res.status(404).json({success: false, message: "User not found"});
      return;
    }

    const userData = userDoc.data();
    const currentTier = userData?.oauthTier || 'full';

    // Check if user has the required scopes for the target tier
    const grantedScopes = userData?.grantedScopes || [];
    if (tier === 'full' && !grantedScopes.includes('channel:manage:moderators')) {
      res.status(403).json({
        success: false,
        message: "You need to re-authenticate with additional permissions to use Chatbot Mode.",
        needsReauth: true,
      });
      return;
    }

    await userDocRef.update({
      oauthTier: tier,
    });

    // Sync botMode in ttsChannelConfigs for the TTS bot service
    // Map oauthTier to botMode: 'anonymous' → 'anonymous', 'full' → 'authenticated'
    const botMode = tier === 'anonymous' ? 'anonymous' : 'authenticated';
    const ttsConfigDocRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(req.user.userLogin);
    await ttsConfigDocRef.set({
      botMode: botMode,
    }, {merge: true});
    log.info({botMode, tier}, "Synced botMode to ttsChannelConfigs");

    log.info({oldTier: currentTier, newTier: tier}, "OAuth tier updated");
    res.json({
      success: true,
      message: `Successfully switched to ${tier === 'anonymous' ? 'Bot-Free' : 'Chatbot'} Mode`,
      tier: tier,
    });
  } catch (error) {
    const err = error as Error;
    log.error({error: err.message}, "Failed to update tier");
    res.status(500).json({
      success: false,
      message: "Failed to update authentication mode",
    });
  }
});

export default router;
