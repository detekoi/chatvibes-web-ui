/**
 * Bot management API routes
 */

import express, { Request, Response, Router } from "express";
import { db, COLLECTIONS } from "../services/firestore";
import { getValidTwitchTokenForUser, getUserIdFromUsername, addModerator } from "../services/twitch";
import { authenticateApiRequest } from "../middleware/auth";
import { secrets, config, secretsLoadedPromise } from "../config";
import { logger, redactSensitive } from "../logger";

const router: Router = express.Router();

// Route: /api/bot/status
router.get("/status", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  const channelLogin = req.user.userLogin;
  const log = logger.child({ endpoint: "/api/bot/status", channelLogin });

  if (!db) {
    log.error("Firestore (db) not initialized!");
    res.status(500).json({ success: false, message: "Firestore not available." });
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
    res.status(500).json({ success: false, message: "Error fetching bot status." });
  }
});

// Route: /api/bot/add
router.post("/add", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  // Ensure secrets are loaded before accessing config
  await secretsLoadedPromise;

  if (!req.user) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  const { userId: twitchUserId, userLogin: channelLogin, displayName } = req.user;
  const log = logger.child({ endpoint: "/api/bot/add", channelLogin, twitchUserId });

  if (!db) {
    log.error("Firestore (db) not initialized!");
    res.status(500).json({ success: false, message: "Firestore not available." });
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
      res.status(403).json({
        success: false,
        message: "Your channel is not authorized to use this bot. Contact me for access: https://parfaitfair.com/#contact",
      });
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

    // Sync botMode in ttsChannelConfigs for the TTS bot service
    // Always use 'authenticated' mode (bot mode only)
    const ttsConfigRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelLogin);
    await ttsConfigRef.set({
      botMode: 'authenticated',
    }, { merge: true });
    log.info({ botMode: 'authenticated' }, "Synced botMode to ttsChannelConfigs");

    log.info("Bot successfully added to channel");

    // Automatically add bot as moderator
    let modStatus: { success: boolean; error?: string } = { success: false, error: "Bot username not configured" };

    if (config.TWITCH_BOT_USERNAME) {
      try {
        log.debug({ botUsername: redactSensitive(config.TWITCH_BOT_USERNAME) }, "Attempting to add bot as moderator");
        const botUserId = await getUserIdFromUsername(config.TWITCH_BOT_USERNAME, secrets);

        if (botUserId) {
          modStatus = await addModerator(channelLogin, twitchUserId, botUserId, secrets);
          if (modStatus.success) {
            log.info("Bot successfully added as moderator");
          } else {
            log.warn({ error: modStatus.error }, "Failed to add bot as moderator");
          }
        } else {
          log.warn({ botUsername: redactSensitive(config.TWITCH_BOT_USERNAME) }, "Could not find user ID for bot username");
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
      res.status(401).json({
        success: false,
        message: "Please re-authenticate with Twitch to add the bot.",
        needsReauth: true,
      });
    } else {
      res.status(500).json({
        success: false,
        message: "Failed to add bot to your channel. Please try again.",
      });
    }
  }
});

// Route: /api/bot/remove
router.post("/remove", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ success: false, message: "Unauthorized" });
    return;
  }

  const { userId: twitchUserId, userLogin: channelLogin } = req.user;
  const log = logger.child({ endpoint: "/api/bot/remove", channelLogin, twitchUserId });

  if (!db) {
    log.error("Firestore (db) not initialized!");
    res.status(500).json({ success: false, message: "Firestore not available." });
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
    res.status(500).json({
      success: false,
      message: "Failed to remove bot from your channel. Please try again.",
    });
  }
});

export default router;