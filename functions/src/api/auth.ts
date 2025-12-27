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

export default router;
