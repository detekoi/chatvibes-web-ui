/**
 * Bot management API routes
 */

import express, { Request, Response, Router } from "express";
import { db, COLLECTIONS } from "../services/firestore";
import { getValidTwitchTokenForUser, getUserIdFromUsername, addModerator } from "../services/twitch";
import { authenticateApiRequest, assertAuthenticated } from "../middleware/auth";
import { secrets, config, secretsLoadedPromise } from "../config";
import { logger } from "../logger";
import { apiError } from "./utils";

const router: Router = express.Router();

// Route: /api/bot/status
router.get("/status", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  assertAuthenticated(req);

  const channelLogin = req.user.userLogin;
  const log = logger.child({ endpoint: "/api/bot/status", channelLogin });

  if (!db) {
    log.error("Firestore (db) not initialized!");
    apiError(res, 500, "storage_unavailable", "Firestore not available.");
    return;
  }

  try {
    // Ensure we have a valid Twitch token for this user
    try {
      await getValidTwitchTokenForUser(req.user.userId, secrets);
      // Token is valid - proceed
    } catch (tokenError) {
      // Token refresh failed, but we can still check bot status
      const err = tokenError as Error;
      log.warn({ error: err.message }, "Token validation failed, but continuing");
    }

    const docRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(req.user.userId);
    const docSnap = await docRef.get();
    const data = docSnap.data();

    if (docSnap.exists && data?.isActive) {
      res.json({
        success: true,
        isActive: true,
        channelName: data.channelName || channelLogin,
        needsReAuth: data.needsTwitchReAuth === true,
      });
    } else {
      res.json({
        success: true,
        isActive: false,
        channelName: channelLogin,
        needsReAuth: docSnap.exists && data?.needsTwitchReAuth === true,
      });
    }
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message }, "Error getting status");
    apiError(res, 500, "bot_status_failed", "Error fetching bot status.");
  }
});

// Route: /api/bot/add
router.post("/add", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  // Ensure secrets are loaded before accessing config
  await secretsLoadedPromise;

  assertAuthenticated(req);

  const { userId: twitchUserId, userLogin: channelLogin, displayName } = req.user;
  const log = logger.child({ endpoint: "/api/bot/add", channelLogin, twitchUserId });

  if (!db) {
    log.error("Firestore (db) not initialized!");
    apiError(res, 500, "storage_unavailable", "Firestore not available.");
    return;
  }

  try {
    // Ensure we have a valid Twitch token for this user
    await getValidTwitchTokenForUser(twitchUserId, secrets);

    log.info("Adding bot to channel");

    const docRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(twitchUserId);

    // Defense-in-depth: verify doc exists (admin-created) even if JWT is valid
    const existingDoc = await docRef.get();
    if (!existingDoc.exists) {
      log.warn("Channel not approved in Firestore");
      // The contact URL travels as a parameter, not embedded in the sentence.
      // The dashboard used to string-match it out of the prose to decide how to
      // render this, which tied the copy to the presentation and broke the
      // moment either changed.
      apiError(
        res,
        403,
        "channel_not_authorized",
        // No URL in the sentence: the client appends it as a link from params,
        // and leaving it here too showed it to the user twice. auth/routes.ts
        // sends the same message without it.
        "Your channel is not authorized to use this bot. Contact me for access.",
        { contactUrl: "https://parfaitfair.com/#contact" },
      );
      return;
    }

    await docRef.set({
      isActive: true,
      twitchUserId,
      twitchUserLogin: channelLogin,
      twitchDisplayName: displayName,
      channelName: channelLogin,
      addedAt: new Date(),
    }, { merge: true });

    log.info("Bot successfully added to channel");

    // Automatically add bot as moderator
    let modStatus: { success: boolean; error?: string } = { success: false, error: "Bot username not configured" };

    if (config.TWITCH_BOT_USERNAME) {
      try {
        log.debug({ botUsername: config.TWITCH_BOT_USERNAME }, "Attempting to add bot as moderator");
        const botUserId = await getUserIdFromUsername(config.TWITCH_BOT_USERNAME, secrets);

        if (botUserId) {
          modStatus = await addModerator(channelLogin, twitchUserId, botUserId, secrets);
          if (modStatus.success) {
            log.info("Bot successfully added as moderator");
          } else {
            log.warn({ error: modStatus.error }, "Failed to add bot as moderator");
          }
        } else {
          log.warn({ botUsername: config.TWITCH_BOT_USERNAME }, "Could not find user ID for bot username");
          modStatus = { success: false, error: "Bot user not found" };
        }
      } catch (modError) {
        const err = modError as Error;
        log.error({ error: err.message }, "Error adding bot as moderator");
        modStatus = { success: false, error: err.message };
      }
    } else {
      log.warn("TWITCH_BOT_USERNAME not configured, skipping moderator setup");
    }

    res.json({
      success: true,
      message: "Bot added to your channel successfully!",
      channelName: channelLogin,
      moderatorStatus: modStatus.success ? "added" : "failed",
      moderatorError: modStatus.success ? undefined : modStatus.error,
    });
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message }, "Error adding bot");
    if (err.message.includes("re-authenticate")) {
      apiError(res, 401, "twitch_reauth_required", "Please re-authenticate with Twitch to add the bot.", undefined, { details: { needsReauth: true } });
    } else {
      apiError(res, 500, "bot_add_failed", "Failed to add bot to your channel. Please try again.");
    }
  }
});

// Route: /api/bot/remove
router.post("/remove", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  assertAuthenticated(req);

  const { userId: twitchUserId, userLogin: channelLogin } = req.user;
  const log = logger.child({ endpoint: "/api/bot/remove", channelLogin, twitchUserId });

  if (!db) {
    log.error("Firestore (db) not initialized!");
    apiError(res, 500, "storage_unavailable", "Firestore not available.");
    return;
  }

  try {
    log.info("Removing bot from channel");

    const docRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(twitchUserId);
    await docRef.update({
      isActive: false,
      removedAt: new Date(),
    });

    log.info("Bot successfully removed from channel");
    res.json({
      success: true,
      message: "Bot removed from your channel successfully!",
      channelName: channelLogin,
    });
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message }, "Error removing bot");
    apiError(res, 500, "bot_remove_failed", "Failed to remove bot from your channel. Please try again.");
  }
});

export default router;