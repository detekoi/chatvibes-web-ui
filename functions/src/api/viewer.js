/**
 * Viewer preferences and settings API routes
 */

const express = require("express");
const {db, COLLECTIONS} = require("../services/firestore");
const {validateSpeed, validatePitch, validateEmotion, validateLanguageBoost, normalizeEmotion} = require("../services/utils");
const {authenticateApiRequest} = require("../middleware/auth");
const {logger} = require("../logger");

// eslint-disable-next-line new-cap
const router = express.Router();

// Route: /api/viewer/auth - Viewer authentication
router.post("/auth", async (req, res) => {
  const log = logger.child({endpoint: "/api/viewer/auth"});
  try {
    const {token} = req.body;

    if (!token) {
      return res.status(400).json({error: "Token is required"});
    }

    // For viewer auth, we might validate against a different service
    // or use a simpler token scheme
    log.info("Authenticating viewer token");

    // This would typically validate the token with your main TTS service
    // For now, we'll return a simple response
    res.json({
      success: true,
      message: "Viewer authenticated successfully",
    });
  } catch (error) {
    log.error({error: error.message}, "Error authenticating viewer");
    res.status(500).json({error: "Authentication failed"});
  }
});

// Route: /api/viewer/preferences/:channel - Get viewer preferences for a specific channel
router.get("/preferences/:channel", authenticateApiRequest, async (req, res) => {
  const {channel} = req.params;
  const username = req.user.userLogin;
  const log = logger.child({endpoint: "/api/viewer/preferences/:channel", channel, username});

  try {
    if (!channel) {
      return res.status(400).json({error: "Channel is required"});
    }

    // Security check: ensure the authenticated user matches the token user
    if (req.user.scope === "viewer" && req.user.tokenUser && req.user.tokenUser !== username) {
      log.warn({tokenUser: req.user.tokenUser}, "SECURITY VIOLATION BLOCKED: User trying to access other user preferences in GET");
      return res.status(403).json({error: "Access denied: token user mismatch"});
    }

    // Check if channel exists and has TTS enabled
    const channelDoc = await db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channel).get();

    if (!channelDoc.exists) {
      return res.status(404).json({error: "Channel not found or TTS not enabled"});
    }

    const channelData = channelDoc.data();

    // Load GLOBAL user preferences
    let globalPrefs = {};
    try {
      const userDoc = await db.collection("ttsUserPreferences").doc(username).get();
      if (userDoc.exists) {
        globalPrefs = userDoc.data() || {};
      }
    } catch (e) {
      log.warn({error: e.message}, "Failed to load global user prefs");
    }

    // Check if user is ignored
    const ttsIgnored = (channelData.ignoredUsers || []).includes(username);

    // Check music ignore status
    let musicIgnored = false;
    try {
      const musicDoc = await db.collection(COLLECTIONS.MUSIC_SETTINGS).doc(channel).get();
      if (musicDoc.exists) {
        musicIgnored = ((musicDoc.data().ignoredUsers || []).includes(username));
      }
    } catch (error) {
      log.warn({error: error.message}, "Failed to check music ignore status");
    }

    // Map global prefs to UI schema (languageBoost -> language)
    const responseBody = {
      voiceId: globalPrefs.voiceId ?? null,
      pitch: (globalPrefs.pitch !== undefined) ? globalPrefs.pitch : null,
      speed: (globalPrefs.speed !== undefined) ? globalPrefs.speed : null,
      emotion: globalPrefs.emotion ?? null,
      language: globalPrefs.languageBoost ?? null,
      englishNormalization: (globalPrefs.englishNormalization !== undefined) ? globalPrefs.englishNormalization : undefined,
      ttsIgnored,
      musicIgnored,
      channelExists: true,
      channelDefaults: {
        voiceId: channelData.voiceId || null,
        pitch: channelData.pitch || null,
        speed: channelData.speed || null,
        emotion: channelData.emotion || null,
        language: channelData.languageBoost || null,
        englishNormalization: channelData.englishNormalization,
      },
    };

    log.info("Preferences retrieved");
    res.json(responseBody);
  } catch (error) {
    log.error({error: error.message}, "Error retrieving preferences");
    res.status(500).json({error: "Failed to retrieve preferences"});
  }
});

// Route: /api/viewer/preferences/:channel - Update viewer preferences for a specific channel
router.put("/preferences/:channel", authenticateApiRequest, async (req, res) => {
  const {channel} = req.params;
  const username = req.user.userLogin;
  const log = logger.child({endpoint: "/api/viewer/preferences/:channel", channel, username});

  try {
    const updates = req.body;

    if (!channel) {
      return res.status(400).json({error: "Channel is required"});
    }

    // Security check
    if (req.user.scope === "viewer" && req.user.tokenUser && req.user.tokenUser !== username) {
      log.warn({tokenUser: req.user.tokenUser}, "SECURITY VIOLATION BLOCKED: User trying to access other user preferences in PUT");
      return res.status(403).json({error: "Access denied: token user mismatch"});
    }

    // Check if channel exists
    const channelDoc = await db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channel).get();
    if (!channelDoc.exists) {
      return res.status(404).json({error: "Channel not found or TTS not enabled"});
    }

    // Prepare update data with validation
    const updateData = {};

    if (updates.voiceId !== undefined) {
      updateData.voiceId = updates.voiceId || null;
    }
    if (updates.pitch !== undefined) {
      if (updates.pitch === null || validatePitch(updates.pitch)) {
        updateData.pitch = updates.pitch;
      } else {
        return res.status(400).json({error: "Invalid pitch value"});
      }
    }
    if (updates.speed !== undefined) {
      if (updates.speed === null || validateSpeed(updates.speed)) {
        updateData.speed = updates.speed;
      } else {
        return res.status(400).json({error: "Invalid speed value"});
      }
    }
    if (updates.emotion !== undefined) {
      const normalized = updates.emotion === null ? null : normalizeEmotion(updates.emotion);
      if (normalized === null || validateEmotion(normalized)) {
        updateData.emotion = normalized;
      } else {
        return res.status(400).json({error: "Invalid emotion value"});
      }
    }
    if (updates.language !== undefined) {
      if (updates.language === null || validateLanguageBoost(updates.language)) {
        updateData.languageBoost = updates.language; // Map UI field to internal field
      } else {
        return res.status(400).json({error: "Invalid language value"});
      }
    }
    if (updates.englishNormalization !== undefined) {
      updateData.englishNormalization = !!updates.englishNormalization;
    }

    // Update global user preferences
    await db.collection("ttsUserPreferences").doc(username).set(updateData, {merge: true});

    log.info("Preferences updated");
    res.json({success: true, message: "Preferences updated successfully"});
  } catch (error) {
    log.error({error: error.message}, "Error updating preferences");
    res.status(500).json({error: "Failed to update preferences"});
  }
});

// Route: /api/viewer/preferences - Get global viewer preferences
router.get("/preferences", authenticateApiRequest, async (req, res) => {
  const username = req.user.userLogin;
  const log = logger.child({endpoint: "/api/viewer/preferences", username});

  try {
    // Load global user preferences
    let globalPrefs = {};
    try {
      const userDoc = await db.collection("ttsUserPreferences").doc(username).get();
      if (userDoc.exists) {
        globalPrefs = userDoc.data() || {};
      }
    } catch (e) {
      log.warn({error: e.message}, "Failed to load global user prefs");
    }

    // Map internal fields to UI schema
    const responseBody = {
      voiceId: globalPrefs.voiceId ?? null,
      pitch: (globalPrefs.pitch !== undefined) ? globalPrefs.pitch : null,
      speed: (globalPrefs.speed !== undefined) ? globalPrefs.speed : null,
      emotion: globalPrefs.emotion ?? null,
      language: globalPrefs.languageBoost ?? null,
      englishNormalization: (globalPrefs.englishNormalization !== undefined) ? globalPrefs.englishNormalization : undefined,
    };

    log.info("Global preferences retrieved");
    res.json(responseBody);
  } catch (error) {
    log.error({error: error.message}, "Error retrieving global preferences");
    res.status(500).json({error: "Failed to retrieve global preferences"});
  }
});

// Route: /api/viewer/preferences - Update global viewer preferences
router.put("/preferences", authenticateApiRequest, async (req, res) => {
  const username = req.user.userLogin;
  const log = logger.child({endpoint: "/api/viewer/preferences", username});

  try {
    const updates = req.body;

    // Prepare update data with validation
    const updateData = {};

    if (updates.voiceId !== undefined) {
      updateData.voiceId = updates.voiceId || null;
    }
    if (updates.pitch !== undefined) {
      if (updates.pitch === null || validatePitch(updates.pitch)) {
        updateData.pitch = updates.pitch;
      } else {
        return res.status(400).json({error: "Invalid pitch value"});
      }
    }
    if (updates.speed !== undefined) {
      if (updates.speed === null || validateSpeed(updates.speed)) {
        updateData.speed = updates.speed;
      } else {
        return res.status(400).json({error: "Invalid speed value"});
      }
    }
    if (updates.emotion !== undefined) {
      const normalized = updates.emotion === null ? null : normalizeEmotion(updates.emotion);
      if (normalized === null || validateEmotion(normalized)) {
        updateData.emotion = normalized;
      } else {
        return res.status(400).json({error: "Invalid emotion value"});
      }
    }
    if (updates.language !== undefined) {
      if (updates.language === null || validateLanguageBoost(updates.language)) {
        updateData.languageBoost = updates.language; // Map UI field to internal field
      } else {
        return res.status(400).json({error: "Invalid language value"});
      }
    }
    if (updates.englishNormalization !== undefined) {
      updateData.englishNormalization = !!updates.englishNormalization;
    }

    // Update global user preferences
    await db.collection("ttsUserPreferences").doc(username).set(updateData, {merge: true});

    log.info("Global preferences updated");
    res.json({success: true, message: "Global preferences updated successfully"});
  } catch (error) {
    log.error({error: error.message}, "Error updating global preferences");
    res.status(500).json({error: "Failed to update global preferences"});
  }
});

// Route: /api/viewer/ignore/tts/:channel - Toggle TTS ignore status
router.post("/ignore/tts/:channel", authenticateApiRequest, async (req, res) => {
  const {channel} = req.params;
  const username = req.user.userLogin;
  const log = logger.child({endpoint: "/api/viewer/ignore/tts/:channel", channel, username});

  try {
    if (!channel) {
      return res.status(400).json({error: "Channel is required"});
    }

    const channelDocRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channel);
    const channelDoc = await channelDocRef.get();

    if (!channelDoc.exists) {
      return res.status(404).json({error: "Channel not found"});
    }

    const channelData = channelDoc.data();
    const ignoredUsers = channelData.ignoredUsers || [];
    const isCurrentlyIgnored = ignoredUsers.includes(username);

    if (isCurrentlyIgnored) {
      // Remove from ignore list
      await channelDocRef.update({
        ignoredUsers: ignoredUsers.filter((user) => user !== username),
      });
      log.info("Removed user from TTS ignore list");
      res.json({success: true, ignored: false, message: "Removed from TTS ignore list"});
    } else {
      // Add to ignore list
      await channelDocRef.update({
        ignoredUsers: [...ignoredUsers, username],
      });
      log.info("Added user to TTS ignore list");
      res.json({success: true, ignored: true, message: "Added to TTS ignore list"});
    }
  } catch (error) {
    log.error({error: error.message}, "Error updating ignore status");
    res.status(500).json({error: "Failed to update ignore status"});
  }
});

// Route: /api/viewer/ignore/music/:channel - Toggle music ignore status
router.post("/ignore/music/:channel", authenticateApiRequest, async (req, res) => {
  const {channel} = req.params;
  const username = req.user.userLogin;
  const log = logger.child({endpoint: "/api/viewer/ignore/music/:channel", channel, username});

  try {
    if (!channel) {
      return res.status(400).json({error: "Channel is required"});
    }

    const musicDocRef = db.collection(COLLECTIONS.MUSIC_SETTINGS).doc(channel);
    const musicDoc = await musicDocRef.get();

    if (!musicDoc.exists) {
      // Create music settings document if it doesn't exist
      await musicDocRef.set({
        enabled: false,
        ignoredUsers: [username],
      });
      log.info("Created music settings and added user to ignore list");
      return res.json({success: true, ignored: true, message: "Added to music ignore list"});
    }

    const musicData = musicDoc.data();
    const ignoredUsers = musicData.ignoredUsers || [];
    const isCurrentlyIgnored = ignoredUsers.includes(username);

    if (isCurrentlyIgnored) {
      // Remove from ignore list
      await musicDocRef.update({
        ignoredUsers: ignoredUsers.filter((user) => user !== username),
      });
      log.info("Removed user from music ignore list");
      res.json({success: true, ignored: false, message: "Removed from music ignore list"});
    } else {
      // Add to ignore list
      await musicDocRef.update({
        ignoredUsers: [...ignoredUsers, username],
      });
      log.info("Added user to music ignore list");
      res.json({success: true, ignored: true, message: "Added to music ignore list"});
    }
  } catch (error) {
    log.error({error: error.message}, "Error updating music ignore status");
    res.status(500).json({error: "Failed to update music ignore status"});
  }
});

module.exports = router;
