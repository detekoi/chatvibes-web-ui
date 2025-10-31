/**
 * Bot management API routes
 */

const express = require("express");
const {db, COLLECTIONS} = require("../services/firestore");
const {getValidTwitchTokenForUser, getUserIdFromUsername, addModerator} = require("../services/twitch");
const {getAllowedChannelsList} = require("../services/utils");
const {authenticateApiRequest} = require("../middleware/auth");
const {secrets, config, secretsLoadedPromise} = require("../config");

// eslint-disable-next-line new-cap
const router = express.Router();

// Route: /api/bot/status
router.get("/status", authenticateApiRequest, async (req, res) => {
  const channelLogin = req.user.userLogin;
  if (!db) {
    console.error("[API /status] Firestore (db) not initialized!");
    return res.status(500).json({success: false, message: "Firestore not available."});
  }

  try {
    // Ensure we have a valid Twitch token for this user
    try {
      await getValidTwitchTokenForUser(channelLogin, secrets);
      // Token is valid - proceed
    } catch (tokenError) {
      // Token refresh failed, but we can still check bot status
      console.warn(`[API /status] Token validation failed for ${channelLogin}, but continuing:`, tokenError.message);
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
    console.error(`[API /status] Error getting status for ${channelLogin}:`, error);
    res.status(500).json({success: false, message: "Error fetching bot status."});
  }
});

// Route: /api/bot/add
router.post("/add", authenticateApiRequest, async (req, res) => {
  // Ensure secrets are loaded before accessing config
  await secretsLoadedPromise;

  const {userId: twitchUserId, userLogin: channelLogin, displayName} = req.user;
  if (!db) {
    console.error("[API /add] Firestore (db) not initialized!");
    return res.status(500).json({success: false, message: "Firestore not available."});
  }

  // Enforce allow-list FIRST (check BEFORE token validation to return accurate errors)
  try {
    const allowedList = await getAllowedChannelsList();
    if (allowedList !== null && !allowedList.includes(channelLogin.toLowerCase())) {
      console.log(`[API /add] Channel ${channelLogin} not in allow-list. Access denied.`);
      return res.status(403).json({
        success: false,
        message: "Your channel is not authorized to use this bot. Please contact support if you believe this is an error.",
      });
    }
  } catch (allowListError) {
    console.error("[API /add] Error checking allow-list:", allowListError.message);
    return res.status(500).json({
      success: false,
      message: "Server error while checking channel authorization.",
    });
  }

  try {
    // Ensure we have a valid Twitch token for this user
    await getValidTwitchTokenForUser(channelLogin, secrets);

    console.log(`[API /add] Adding bot to channel: ${channelLogin} (User ID: ${twitchUserId})`);

    const docRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(channelLogin);
    await docRef.set({
      isActive: true,
      twitchUserId,
      twitchUserLogin: channelLogin,
      twitchDisplayName: displayName,
      channelName: channelLogin,
      addedAt: new Date(),
    }, {merge: true});

    console.log(`[API /add] Bot successfully added to channel: ${channelLogin}`);

    // Automatically add bot as moderator
    let modStatus = {success: false, error: "Bot username not configured"};
    if (config.TWITCH_BOT_USERNAME) {
      try {
        console.log(`[API /add] Attempting to add bot ${config.TWITCH_BOT_USERNAME} as moderator...`);
        const botUserId = await getUserIdFromUsername(config.TWITCH_BOT_USERNAME, secrets);

        if (botUserId) {
          modStatus = await addModerator(channelLogin, twitchUserId, botUserId, secrets);
          if (modStatus.success) {
            console.log(`[API /add] Bot successfully added as moderator to ${channelLogin}`);
          } else {
            console.warn(`[API /add] Failed to add bot as moderator: ${modStatus.error}`);
          }
        } else {
          console.warn(`[API /add] Could not find user ID for bot username: ${config.TWITCH_BOT_USERNAME}`);
          modStatus = {success: false, error: "Bot user not found"};
        }
      } catch (modError) {
        console.error(`[API /add] Error adding bot as moderator:`, modError);
        modStatus = {success: false, error: modError.message};
      }
    } else {
      console.warn(`[API /add] TWITCH_BOT_USERNAME not configured, skipping moderator setup`);
    }

    res.json({
      success: true,
      message: "Bot added to your channel successfully!",
      channelName: channelLogin,
      moderatorStatus: modStatus.success ? "added" : "failed",
      moderatorError: modStatus.success ? undefined : modStatus.error,
    });
  } catch (error) {
    console.error(`[API /add] Error adding bot to ${channelLogin}:`, error);
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
  if (!db) {
    console.error("[API /remove] Firestore (db) not initialized!");
    return res.status(500).json({success: false, message: "Firestore not available."});
  }

  try {
    console.log(`[API /remove] Removing bot from channel: ${channelLogin} (User ID: ${twitchUserId})`);

    const docRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(channelLogin);
    await docRef.update({
      isActive: false,
      removedAt: new Date(),
    });

    console.log(`[API /remove] Bot successfully removed from channel: ${channelLogin}`);
    res.json({
      success: true,
      message: "Bot removed from your channel successfully!",
      channelName: channelLogin,
    });
  } catch (error) {
    console.error(`[API /remove] Error removing bot from ${channelLogin}:`, error);
    res.status(500).json({
      success: false,
      message: "Failed to remove bot from your channel. Please try again.",
    });
  }
});

module.exports = router;
