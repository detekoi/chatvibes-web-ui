/**
 * Viewer preferences and settings API routes
 */

import express, { Request, Response, Router } from "express";
import { db, COLLECTIONS } from "../services/firestore";
import { validateSpeed, validatePitch, validateEmotion, validateLanguageBoost, normalizeEmotion } from "../services/utils";
import { loadGlobalUserPreferences, ViewerPreferences } from "../services/preferences";
import { authenticateApiRequest, assertAuthenticated } from "../middleware/auth";
import { logger } from "../logger";

const router: Router = express.Router();



interface PreferencesUpdate {
  voiceId?: string | null;
  pitch?: number | null;
  speed?: number | null;
  emotion?: string | null;
  language?: string | null;
  englishNormalization?: boolean;
  emoteMode?: string | null;
}

const VALID_EMOTE_MODES = ["read", "skip", "describe"];


async function getChannelIdFromName(channelName: string): Promise<string | null> {
  try {
    const snapshot = await db.collection(COLLECTIONS.MANAGED_CHANNELS)
      .where('channelName', '==', channelName.toLowerCase())
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    return snapshot.docs[0].data().twitchUserId || snapshot.docs[0].id;
  } catch (error) {
    logger.error({ error, channelName }, "Error resolving channel name to ID");
    return null;
  }
}

function validateAndBuildUpdateData(
  updates: PreferencesUpdate,
  res: Response
): Partial<ViewerPreferences> | null {
  if (!updates) {
    res.status(400).json({ error: "Missing update data" });
    return null;
  }
  const updateData: Partial<ViewerPreferences> = {};

  if (updates.voiceId !== undefined) {
    updateData.voiceId = updates.voiceId || null;
  }
  if (updates.pitch !== undefined) {
    if (updates.pitch === null || validatePitch(updates.pitch)) {
      updateData.pitch = updates.pitch;
    } else {
      res.status(400).json({ error: "Invalid pitch value" });
      return null;
    }
  }
  if (updates.speed !== undefined) {
    if (updates.speed === null || validateSpeed(updates.speed)) {
      updateData.speed = updates.speed;
    } else {
      res.status(400).json({ error: "Invalid speed value" });
      return null;
    }
  }
  if (updates.emotion !== undefined) {
    const normalized = updates.emotion === null ? null : normalizeEmotion(updates.emotion);
    if (normalized === null || validateEmotion(normalized)) {
      updateData.emotion = normalized;
    } else {
      res.status(400).json({ error: "Invalid emotion value" });
      return null;
    }
  }
  if (updates.language !== undefined) {
    if (updates.language === null || validateLanguageBoost(updates.language)) {
      updateData.languageBoost = updates.language; // Map UI field to internal field
    } else {
      res.status(400).json({ error: "Invalid language value" });
      return null;
    }
  }
  if (updates.englishNormalization !== undefined) {
    updateData.englishNormalization = !!updates.englishNormalization;
  }
  if (updates.emoteMode !== undefined) {
    if (updates.emoteMode === null || VALID_EMOTE_MODES.includes(updates.emoteMode)) {
      updateData.emoteMode = updates.emoteMode;
    } else {
      res.status(400).json({ error: "Invalid emoteMode value. Must be 'read', 'skip', or 'describe'." });
      return null;
    }
  }

  return updateData;
}

// Route: /api/viewer/auth - Viewer authentication

router.post("/auth", async (req: Request, res: Response): Promise<void> => {
  const log = logger.child({ endpoint: "/api/viewer/auth" });
  try {
    const { token } = req.body;

    if (!token) {
      res.status(400).json({ error: "Token is required" });
      return;
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
    const err = error as Error;
    log.error({ error: err.message }, "Error authenticating viewer");
    res.status(500).json({ error: "Authentication failed" });
  }
});

// Route: /api/viewer/preferences/:channel - Get viewer preferences for a specific channel
router.get("/preferences/:channel", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  const { channel } = req.params;
  assertAuthenticated(req);

  const username = req.user.userLogin;
  const log = logger.child({ endpoint: "/api/viewer/preferences/:channel", channel, username });

  try {
    if (!channel) {
      res.status(400).json({ error: "Channel is required" });
      return;
    }

    // Security check: ensure the authenticated user matches the token user
    if (req.user.scope === "viewer" && req.user.tokenUser && req.user.tokenUser !== username) {
      log.warn({ tokenUser: req.user.tokenUser }, "SECURITY VIOLATION BLOCKED: User trying to access other user preferences in GET");
      res.status(403).json({ error: "Access denied: token user mismatch" });
      return;
    }
    const channelId = await getChannelIdFromName(channel);
    if (!channelId) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    const channelDoc = await db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelId).get();


    if (!channelDoc.exists) {
      res.status(404).json({ error: "Channel not found or TTS not enabled" });
      return;
    }

    const channelData = channelDoc.data();
    if (!channelData) {
      res.status(404).json({ error: "Channel data not found" });
      return;
    }

    // Load GLOBAL user preferences
    let globalPrefs: ViewerPreferences = {};
    try {
      globalPrefs = await loadGlobalUserPreferences(req.user.userId, username);
    } catch (e) {
      const err = e as Error;
      log.warn({ error: err.message }, "Failed to load global user prefs");
    }

    // Check if user is ignored
    const ttsIgnored = (channelData.ignoredUsers || []).includes(username);


    // Map global prefs to UI schema (languageBoost -> language)
    const responseBody = {
      voiceId: globalPrefs.voiceId ?? null,
      pitch: (globalPrefs.pitch !== undefined) ? globalPrefs.pitch : null,
      speed: (globalPrefs.speed !== undefined) ? globalPrefs.speed : null,
      emotion: globalPrefs.emotion ?? null,
      language: globalPrefs.languageBoost ?? null,
      englishNormalization: (globalPrefs.englishNormalization !== undefined) ? globalPrefs.englishNormalization : undefined,
      emoteMode: globalPrefs.emoteMode ?? null,
      ignoreStatus: {
        tts: ttsIgnored,
      },
      channelExists: true,
      channelPolicy: {
        allowViewerPreferences: channelData.allowViewerPreferences !== false,
      },
      channelDefaults: {
        voiceId: channelData.voiceId || null,
        pitch: channelData.pitch !== undefined ? channelData.pitch : null,
        speed: channelData.speed !== undefined ? channelData.speed : null,
        emotion: channelData.emotion || null,
        language: channelData.languageBoost || null,
        englishNormalization: channelData.englishNormalization,
        emoteMode: channelData.emoteMode || null,
      },
    };

    log.info("Preferences retrieved");
    res.json(responseBody);
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message }, "Error retrieving preferences");
    res.status(500).json({ error: "Failed to retrieve preferences" });
  }
});

// Route: /api/viewer/preferences/:channel - Update viewer preferences for a specific channel
router.put("/preferences/:channel", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  const { channel } = req.params;
  assertAuthenticated(req);

  const username = req.user.userLogin;
  const log = logger.child({ endpoint: "/api/viewer/preferences/:channel", channel, username });

  try {
    const updates: PreferencesUpdate = req.body;

    if (!channel) {
      res.status(400).json({ error: "Channel is required" });
      return;
    }

    // Security check
    if (req.user.scope === "viewer" && req.user.tokenUser && req.user.tokenUser !== username) {
      log.warn({ tokenUser: req.user.tokenUser }, "SECURITY VIOLATION BLOCKED: User trying to access other user preferences in PUT");
      res.status(403).json({ error: "Access denied: token user mismatch" });
      return;
    }
    const channelId = await getChannelIdFromName(channel);
    if (!channelId) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    const channelDoc = await db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelId).get();

    if (!channelDoc.exists) {
      res.status(404).json({ error: "Channel not found or TTS not enabled" });
      return;
    }

    // Prepare update data with validation
    const updateData = validateAndBuildUpdateData(updates, res);
    if (!updateData) return;

    // Update global user preferences using User ID
    await db.collection(COLLECTIONS.TTS_USER_PREFS).doc(req.user.userId).set(updateData, { merge: true });

    log.info("Preferences updated");
    res.json({ success: true, message: "Preferences updated successfully" });
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message }, "Error updating preferences");
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

// Route: /api/viewer/preferences - Get global viewer preferences
router.get("/preferences", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  assertAuthenticated(req);

  const username = req.user.userLogin;
  const log = logger.child({ endpoint: "/api/viewer/preferences", username });

  try {
    // Load GLOBAL user preferences
    let globalPrefs: ViewerPreferences = {};
    try {
      globalPrefs = await loadGlobalUserPreferences(req.user.userId, username);
    } catch (e) {
      const err = e as Error;
      log.warn({ error: err.message }, "Failed to load global user prefs");
    }

    // Map internal fields to UI schema
    const responseBody = {
      voiceId: globalPrefs.voiceId ?? null,
      pitch: (globalPrefs.pitch !== undefined) ? globalPrefs.pitch : null,
      speed: (globalPrefs.speed !== undefined) ? globalPrefs.speed : null,
      emotion: globalPrefs.emotion ?? null,
      language: globalPrefs.languageBoost ?? null,
      englishNormalization: (globalPrefs.englishNormalization !== undefined) ? globalPrefs.englishNormalization : undefined,
      emoteMode: globalPrefs.emoteMode ?? null,
    };

    log.info("Global preferences retrieved");
    res.json(responseBody);
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message }, "Error retrieving global preferences");
    res.status(500).json({ error: "Failed to retrieve global preferences" });
  }
});

// Route: /api/viewer/preferences - Update global viewer preferences
router.put("/preferences", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  assertAuthenticated(req);

  const username = req.user.userLogin;
  const log = logger.child({ endpoint: "/api/viewer/preferences", username });

  try {
    const updates: PreferencesUpdate = req.body;

    // Prepare update data with validation
    const updateData = validateAndBuildUpdateData(updates, res);
    if (!updateData) return;

    // Update global user preferences using User ID
    await db.collection(COLLECTIONS.TTS_USER_PREFS).doc(req.user.userId).set(updateData, { merge: true });

    log.info("Global preferences updated");
    res.json({ success: true, message: "Global preferences updated successfully" });
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message }, "Error updating global preferences");
    res.status(500).json({ error: "Failed to update global preferences" });
  }
});

// Route: /api/viewer/ignore/tts/:channel - Toggle TTS ignore status
router.post("/ignore/tts/:channel", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  const { channel } = req.params;
  assertAuthenticated(req);

  const username = req.user.userLogin;
  const log = logger.child({ endpoint: "/api/viewer/ignore/tts/:channel", channel, username });

  try {
    if (!channel) {
      res.status(400).json({ error: "Channel is required" });
      return;
    }
    const channelId = await getChannelIdFromName(channel);
    if (!channelId) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }
    const channelDocRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelId);

    const channelDoc = await channelDocRef.get();

    if (!channelDoc.exists) {
      res.status(404).json({ error: "Channel not found" });
      return;
    }

    const channelData = channelDoc.data();
    if (!channelData) {
      res.status(404).json({ error: "Channel data not found" });
      return;
    }

    const ignoredUsers: string[] = channelData.ignoredUsers || [];
    const isCurrentlyIgnored = ignoredUsers.includes(username);

    if (isCurrentlyIgnored) {
      // Remove from ignore list
      await channelDocRef.update({
        ignoredUsers: ignoredUsers.filter((user) => user !== username),
      });
      log.info("Removed user from TTS ignore list");
      res.json({ success: true, ignored: false, message: "Removed from TTS ignore list" });
    } else {
      // Add to ignore list
      await channelDocRef.update({
        ignoredUsers: [...ignoredUsers, username],
      });
      log.info("Added user to TTS ignore list");
      res.json({ success: true, ignored: true, message: "Added to TTS ignore list" });
    }
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message }, "Error updating ignore status");
    res.status(500).json({ error: "Failed to update ignore status" });
  }
});

export default router;
