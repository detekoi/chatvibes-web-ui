/**
 * Bot management API routes
 */

import express, {Request, Response, Router} from "express";
import {db, COLLECTIONS} from "../services/firestore";
import {getValidTwitchTokenForUser, getUserIdFromUsername, addModerator} from "../services/twitch";
import {getAllowedChannelsList} from "../services/utils";
import {authenticateApiRequest} from "../middleware/auth";
import {secrets, config, secretsLoadedPromise} from "../config";
import {logger} from "../logger";

const router: Router = express.Router();

// Route: /api/bot/status
router.get("/status", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({success: false, message: "Unauthorized"});
    return;
  }

  const channelLogin = req.user.userLogin;
  const log = logger.child({endpoint: "/api/bot/status", channelLogin});

  if (!db) {
    log.error("Firestore (db) not initialized!");
    res.status(500).json({success: false, message: "Firestore not available."});
    return;
  }

  try {
    // Ensure we have a valid Twitch token for this user
    try {
      await getValidTwitchTokenForUser(channelLogin, secrets);
      // Token is valid - proceed
    } catch (tokenError) {
      // Token refresh failed, but we can still check bot status
      const err = tokenError as Error;
      log.warn({error: err.message}, "Token validation failed, but continuing");
    }

    const docRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(channelLogin);
    const docSnap = await docRef.get();
    const data = docSnap.data();

    if (docSnap.exists && data?.isActive) {
      res.json({
        success: true,
        isActive: true,
        channelName: data.channelName || channelLogin,
        needsReAuth: data.needsTwitchReAuth === true,
        oauthTier: data.oauthTier || 'full', // Default to 'full' for backward compatibility
      });
    } else {
      res.json({
        success: true,
        isActive: false,
        channelName: channelLogin,
        needsReAuth: docSnap.exists && data?.needsTwitchReAuth === true,
        oauthTier: docSnap.exists && data ? (data.oauthTier || 'full') : 'full',
      });
    }
  } catch (error) {
    const err = error as Error;
    log.error({error: err.message}, "Error getting status");
    res.status(500).json({success: false, message: "Error fetching bot status."});
  }
});

// Route: /api/bot/add
router.post("/add", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  // Ensure secrets are loaded before accessing config
  await secretsLoadedPromise;

  if (!req.user) {
    res.status(401).json({success: false, message: "Unauthorized"});
    return;
  }

  const {userId: twitchUserId, userLogin: channelLogin, displayName} = req.user;
  const log = logger.child({endpoint: "/api/bot/add", channelLogin, twitchUserId});

  if (!db) {
    log.error("Firestore (db) not initialized!");
    res.status(500).json({success: false, message: "Firestore not available."});
    return;
  }

  // Enforce allow-list FIRST (check BEFORE token validation to return accurate errors)
  try {
    const allowedList = await getAllowedChannelsList();
    if (allowedList !== null && !allowedList.includes(channelLogin.toLowerCase())) {
      log.warn("Channel not in allow-list. Access denied.");
      res.status(403).json({
        success: false,
        message: "Your channel is not authorized to use this bot. Please contact support if you believe this is an error.",
      });
      return;
    }
  } catch (allowListError) {
    const err = allowListError as Error;
    log.error({error: err.message}, "Error checking allow-list");
    res.status(500).json({
      success: false,
      message: "Server error while checking channel authorization.",
    });
    return;
  }

  try {
    // Ensure we have a valid Twitch token for this user
    await getValidTwitchTokenForUser(channelLogin, secrets);

    log.info("Adding bot to channel");

    const docRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(channelLogin);

    // Get current user data to check OAuth tier
    const docSnap = await docRef.get();
    const userData = docSnap.data();
    const oauthTier = userData?.oauthTier || 'full';

    await docRef.set({
      isActive: true,
      twitchUserId,
      twitchUserLogin: channelLogin,
      twitchDisplayName: displayName,
      channelName: channelLogin,
      addedAt: new Date(),
    }, {merge: true});

    log.info("Bot successfully added to channel");

    // Automatically add bot as moderator only if in full/chatbot mode
    let modStatus: {success: boolean; error?: string} = {success: false, error: "Bot username not configured"};

    if (oauthTier === 'anonymous') {
      // In Bot-Free Mode, don't add as moderator
      log.info("Bot-Free Mode (anonymous tier) - skipping moderator setup");
      modStatus = {success: true}; // Not an error, just skipped
    } else if (config.TWITCH_BOT_USERNAME) {
      try {
        log.debug({botUsername: config.TWITCH_BOT_USERNAME}, "Attempting to add bot as moderator");
        const botUserId = await getUserIdFromUsername(config.TWITCH_BOT_USERNAME, secrets);

        if (botUserId) {
          modStatus = await addModerator(channelLogin, twitchUserId, botUserId, secrets);
          if (modStatus.success) {
            log.info("Bot successfully added as moderator");
          } else {
            log.warn({error: modStatus.error}, "Failed to add bot as moderator");
          }
        } else {
          log.warn({botUsername: config.TWITCH_BOT_USERNAME}, "Could not find user ID for bot username");
          modStatus = {success: false, error: "Bot user not found"};
        }
      } catch (modError) {
        const err = modError as Error;
        log.error({error: err.message}, "Error adding bot as moderator");
        modStatus = {success: false, error: err.message};
      }
    } else {
      log.warn("TWITCH_BOT_USERNAME not configured, skipping moderator setup");
    }

    const successMessage = oauthTier === 'anonymous'
      ? "TTS Service activated in Bot-Free Mode! The bot will not appear in your chat."
      : "Bot added to your channel successfully!";

    res.json({
      success: true,
      message: successMessage,
      channelName: channelLogin,
      moderatorStatus: oauthTier === 'anonymous' ? "skipped" : (modStatus.success ? "added" : "failed"),
      moderatorError: modStatus.success ? undefined : modStatus.error,
      oauthTier: oauthTier,
    });
  } catch (error) {
    const err = error as Error;
    log.error({error: err.message}, "Error adding bot");
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
    res.status(401).json({success: false, message: "Unauthorized"});
    return;
  }

  const {userId: twitchUserId, userLogin: channelLogin} = req.user;
  const log = logger.child({endpoint: "/api/bot/remove", channelLogin, twitchUserId});

  if (!db) {
    log.error("Firestore (db) not initialized!");
    res.status(500).json({success: false, message: "Firestore not available."});
    return;
  }

  try {
    log.info("Removing bot from channel");

    const docRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(channelLogin);
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
    log.error({error: err.message}, "Error removing bot");
    res.status(500).json({
      success: false,
      message: "Failed to remove bot from your channel. Please try again.",
    });
  }
});

export default router;
