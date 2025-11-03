/**
 * Bot management API routes
 */

const express = require("express");
const {db, COLLECTIONS} = require("../services/firestore");
const {getValidTwitchTokenForUser, getUserIdFromUsername, addModerator} = require("../services/twitch");
const {getAllowedChannelsList} = require("../services/utils");
const {authenticateApiRequest} = require("../middleware/auth");
const {secrets, config, secretsLoadedPromise} = require("../config");
const {logger} = require("../logger");

// eslint-disable-next-line new-cap
const router = express.Router();

// Route: /api/bot/status
router.get("/status", authenticateApiRequest, async (req, res) => {
  const channelLogin = req.user.userLogin;
  const log = logger.child({endpoint: "/api/bot/status", channelLogin});
  
  if (!db) {
    log.error("Firestore (db) not initialized!");
    return res.status(500).json({success: false, message: "Firestore not available."});
  }

  try {
    // Ensure we have a valid Twitch token for this user
    try {
      await getValidTwitchTokenForUser(channelLogin, secrets);
      // Token is valid - proceed
    } catch (tokenError) {
      // Token refresh failed, but we can still check bot status
      log.warn({error: tokenError.message}, "Token validation failed, but continuing");
    }

    const docRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(channelLogin);
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
    log.error({error: error.message}, "Error getting status");
    res.status(500).json({success: false, message: "Error fetching bot status."});
  }
});

// Route: /api/bot/add
router.post("/add", authenticateApiRequest, async (req, res) => {
  // Ensure secrets are loaded before accessing config
  await secretsLoadedPromise;

  const {userId: twitchUserId, userLogin: channelLogin, displayName} = req.user;
  const log = logger.child({endpoint: "/api/bot/add", channelLogin, twitchUserId});
  
  if (!db) {
    log.error("Firestore (db) not initialized!");
    return res.status(500).json({success: false, message: "Firestore not available."});
  }

  // Enforce allow-list FIRST (check BEFORE token validation to return accurate errors)
  try {
    const allowedList = await getAllowedChannelsList();
    if (allowedList !== null && !allowedList.includes(channelLogin.toLowerCase())) {
      log.warn("Channel not in allow-list. Access denied.");
      return res.status(403).json({
        success: false,
        message: "Your channel is not authorized to use this bot. Please contact support if you believe this is an error.",
      });
    }
  } catch (allowListError) {
    log.error({error: allowListError.message}, "Error checking allow-list");
    return res.status(500).json({
      success: false,
      message: "Server error while checking channel authorization.",
    });
  }

  try {
    // Ensure we have a valid Twitch token for this user
    await getValidTwitchTokenForUser(channelLogin, secrets);

    log.info("Adding bot to channel");

    const docRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(channelLogin);
    await docRef.set({
      isActive: true,
      twitchUserId,
      twitchUserLogin: channelLogin,
      twitchDisplayName: displayName,
      channelName: channelLogin,
      addedAt: new Date(),
    }, {merge: true});

    log.info("Bot successfully added to channel");

    // Automatically add bot as moderator
    let modStatus = {success: false, error: "Bot username not configured"};
    if (config.TWITCH_BOT_USERNAME) {
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
        log.error({error: modError.message}, "Error adding bot as moderator");
        modStatus = {success: false, error: modError.message};
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
    log.error({error: error.message}, "Error adding bot");
    if (error.message.includes("re-authenticate")) {
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
router.post("/remove", authenticateApiRequest, async (req, res) => {
  const {userId: twitchUserId, userLogin: channelLogin} = req.user;
  const log = logger.child({endpoint: "/api/bot/remove", channelLogin, twitchUserId});
  
  if (!db) {
    log.error("Firestore (db) not initialized!");
    return res.status(500).json({success: false, message: "Firestore not available."});
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
    log.error({error: error.message}, "Error removing bot");
    res.status(500).json({
      success: false,
      message: "Failed to remove bot from your channel. Please try again.",
    });
  }
});

module.exports = router;
