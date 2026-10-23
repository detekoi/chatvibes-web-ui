/**
 * Viewer preferences and settings API routes
 */

import express, { Request, Response, Router } from "express";
import { db, COLLECTIONS, FieldValue, FieldPath } from "../services/firestore";
import { validateSpeed, validatePitch, validateEmotion, validateLanguageBoost, normalizeEmotion } from "../services/utils";
import { loadGlobalUserPreferences, ViewerPreferences } from "../services/preferences";
import { RELEASED_VOICES } from "../services/voice-list";
import { authenticateApiRequest, assertAuthenticated } from "../middleware/auth";
import { logger } from "../logger";
import { getIgnoreEntry, buildIgnoreEntry, canSelfUnignore, IGNORE_SOURCE_SELF } from "../services/ignoreEntries";
import { apiError } from "./utils";

const VOICE_IDS = new Set(RELEASED_VOICES);

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
    apiError(res, 400, "prefs_missing_data", "Missing update data");
    return null;
  }
  const updateData: Partial<ViewerPreferences> = {};

  if (updates.voiceId !== undefined) {
    // Unlike its siblings this used to accept any string, which let a viewer
    // store arbitrary text that the broadcaster's dashboard later renders.
    if (!updates.voiceId || VOICE_IDS.has(updates.voiceId)) {
      updateData.voiceId = updates.voiceId || null;
    } else {
      apiError(res, 400, "prefs_invalid_voice", "Invalid voiceId value");
      return null;
    }
  }
  if (updates.pitch !== undefined) {
    if (updates.pitch === null || validatePitch(updates.pitch)) {
      updateData.pitch = updates.pitch;
    } else {
      apiError(res, 400, "prefs_invalid_pitch", "Invalid pitch value");
      return null;
    }
  }
  if (updates.speed !== undefined) {
    if (updates.speed === null || validateSpeed(updates.speed)) {
      updateData.speed = updates.speed;
    } else {
      apiError(res, 400, "prefs_invalid_speed", "Invalid speed value");
      return null;
    }
  }
  if (updates.emotion !== undefined) {
    const normalized = updates.emotion === null ? null : normalizeEmotion(updates.emotion);
    if (normalized === null || validateEmotion(normalized)) {
      updateData.emotion = normalized;
    } else {
      apiError(res, 400, "prefs_invalid_emotion", "Invalid emotion value");
      return null;
    }
  }
  if (updates.language !== undefined) {
    if (updates.language === null || validateLanguageBoost(updates.language)) {
      updateData.languageBoost = updates.language; // Map UI field to internal field
    } else {
      apiError(res, 400, "prefs_invalid_language", "Invalid language value");
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
      apiError(res, 400, "prefs_invalid_emote_mode", "Invalid emoteMode value. Must be 'read', 'skip', or 'describe'.");
      return null;
    }
  }

  return updateData;
}

// Route: /api/viewer/preferences/:channel - Get viewer preferences for a specific channel
router.get("/preferences/:channel", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  const { channel } = req.params;
  assertAuthenticated(req);

  const username = req.user.userLogin;
  const log = logger.child({ endpoint: "/api/viewer/preferences/:channel", channel, username });

  try {
    if (!channel) {
      apiError(res, 400, "channel_required", "Channel is required");
      return;
    }

    const channelId = await getChannelIdFromName(channel);
    if (!channelId) {
      apiError(res, 404, "channel_not_found", "Channel not found");
      return;
    }
    const channelDoc = await db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelId).get();


    if (!channelDoc.exists) {
      apiError(res, 404, "channel_tts_disabled", "Channel not found or TTS not enabled");
      return;
    }

    const channelData = channelDoc.data();
    if (!channelData) {
      apiError(res, 404, "channel_data_not_found", "Channel data not found");
      return;
    }

    // Load GLOBAL user preferences
    let globalPrefs: ViewerPreferences = {};
    // Without the document the opt-out state is unknown. The voice controls can
    // fall back to defaults, but reporting `false` would show a viewer who opted
    // out as opted in, so the flag goes out as null and the page hides it.
    let prefsLoaded = true;
    try {
      globalPrefs = await loadGlobalUserPreferences(req.user.userId);
    } catch (e) {
      const err = e as Error;
      prefsLoaded = false;
      log.warn({ error: err.message }, "Failed to load global user prefs");
    }

    // Check if user is ignored, by immutable user ID rather than by login.
    // The entry carries who imposed it, which is what tells the page whether to
    // offer the viewer a way back out or explain that a moderator set it.
    const ttsEntry = getIgnoreEntry(channelData.ignoredUserIds, `twitch:${req.user.userId}`);
    const ttsIgnored = ttsEntry !== null;


    // Map global prefs to UI schema (languageBoost -> language)
    const responseBody = {
      voiceId: globalPrefs.voiceId ?? null,
      pitch: (globalPrefs.pitch !== undefined) ? globalPrefs.pitch : null,
      speed: (globalPrefs.speed !== undefined) ? globalPrefs.speed : null,
      emotion: globalPrefs.emotion ?? null,
      language: globalPrefs.languageBoost ?? null,
      englishNormalization: (globalPrefs.englishNormalization !== undefined) ? globalPrefs.englishNormalization : undefined,
      emoteMode: globalPrefs.emoteMode ?? null,
      globalOptOut: prefsLoaded ? globalPrefs.globalOptOut === true : null,
      ignoreStatus: {
        tts: ttsIgnored,
        ttsSource: ttsEntry?.source ?? null,
        ttsCanSelfUndo: canSelfUnignore(ttsEntry),
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
    apiError(res, 500, "prefs_fetch_failed", "Failed to retrieve preferences");
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
      apiError(res, 400, "channel_required", "Channel is required");
      return;
    }

    const channelId = await getChannelIdFromName(channel);
    if (!channelId) {
      apiError(res, 404, "channel_not_found", "Channel not found");
      return;
    }
    const channelDoc = await db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelId).get();

    if (!channelDoc.exists) {
      apiError(res, 404, "channel_tts_disabled", "Channel not found or TTS not enabled");
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
    apiError(res, 500, "prefs_update_failed", "Failed to update preferences");
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
    // Without the document the opt-out state is unknown. The voice controls can
    // fall back to defaults, but reporting `false` would show a viewer who opted
    // out as opted in, so the flag goes out as null and the page hides it.
    let prefsLoaded = true;
    try {
      globalPrefs = await loadGlobalUserPreferences(req.user.userId);
    } catch (e) {
      const err = e as Error;
      prefsLoaded = false;
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
      globalOptOut: prefsLoaded ? globalPrefs.globalOptOut === true : null,
    };

    log.info("Global preferences retrieved");
    res.json(responseBody);
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message }, "Error retrieving global preferences");
    apiError(res, 500, "prefs_global_fetch_failed", "Failed to retrieve global preferences");
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
    apiError(res, 500, "prefs_global_update_failed", "Failed to update global preferences");
  }
});

// Route: /api/viewer/opt-out - Opt out of TTS in every channel, or back in
//
// Takes the state to set rather than toggling, so a retried request cannot undo
// itself. The flag sits on the viewer's own preferences document; it is theirs
// alone, so there is no moderator path and nothing to refuse. The bot drops the
// viewer's speech everywhere while it is set (chatvibes src/lib/globalOptOut.js).
router.put("/opt-out", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  assertAuthenticated(req);

  const username = req.user.userLogin;
  const log = logger.child({ endpoint: "/api/viewer/opt-out", username });

  const optedOut = req.body?.optedOut;
  if (typeof optedOut !== "boolean") {
    apiError(res, 400, "invalid_opt_out", "optedOut must be true or false");
    return;
  }

  try {
    // set + merge rather than update, so opting back in on a viewer who never
    // saved a preference does not fail on a missing document.
    await db.collection(COLLECTIONS.TTS_USER_PREFS).doc(req.user.userId).set(
      optedOut ?
        { globalOptOut: true, globalOptOutAt: new Date().toISOString() } :
        { globalOptOut: FieldValue.delete(), globalOptOutAt: FieldValue.delete() },
      { merge: true },
    );
    log.info({ optedOut }, "Updated global TTS opt-out");
    res.json({ success: true, globalOptOut: optedOut });
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message }, "Error updating global TTS opt-out");
    apiError(res, 500, "opt_out_update_failed", "Failed to update your opt-out");
  }
});

// Route: /api/viewer/ignore/tts/:channel - Set or toggle TTS ignore status
//
// The body `{ ignored: boolean }` names the state to end in, so a double click or
// a tab showing stale state cannot flip the viewer the wrong way. Without a body
// the route toggles, which is what a page cached from before that change sends.
router.post("/ignore/tts/:channel", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  const { channel } = req.params;
  assertAuthenticated(req);

  const username = req.user.userLogin;
  const log = logger.child({ endpoint: "/api/viewer/ignore/tts/:channel", channel, username });

  const wanted: unknown = req.body?.ignored;
  if (wanted !== undefined && typeof wanted !== "boolean") {
    apiError(res, 400, "invalid_opt_out", "ignored must be true or false");
    return;
  }

  try {
    if (!channel) {
      apiError(res, 400, "channel_required", "Channel is required");
      return;
    }
    const channelId = await getChannelIdFromName(channel);
    if (!channelId) {
      apiError(res, 404, "channel_not_found", "Channel not found");
      return;
    }
    const channelDocRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelId);

    const channelDoc = await channelDocRef.get();

    if (!channelDoc.exists) {
      apiError(res, 404, "channel_not_found", "Channel not found");
      return;
    }

    const channelData = channelDoc.data();
    if (!channelData) {
      apiError(res, 404, "channel_data_not_found", "Channel data not found");
      return;
    }

    // The viewer is authenticated, so their immutable user ID is already in hand —
    // no Helix lookup needed to key their own entry.
    const entryKey = `twitch:${req.user.userId}`;
    const existing = getIgnoreEntry(channelData.ignoredUserIds, entryKey);
    const target = typeof wanted === "boolean" ? wanted : !existing;

    if (target === Boolean(existing)) {
      // Already there: a repeated request, or a moderator's entry when the viewer
      // asks to be opted out. Nothing to write either way. `source` lets the page
      // tell a moderator's mute from the viewer's own and lock the switch.
      res.json({ success: true, ignored: target, source: existing?.source ?? null, message: "TTS ignore status unchanged" });
      return;
    }

    if (existing && !canSelfUnignore(existing)) {
      // A moderator put them here, so they do not get to leave. This endpoint used
      // to delete whatever it found, which made a moderator's mute one authenticated
      // request away from being cleared by the account it was aimed at — the
      // disabled checkbox in the UI was the only thing standing in the way.
      // Legacy string entries land here too: unknown provenance is never lifted.
      log.info({ source: existing.source }, "Refused self-undo of a moderator-imposed ignore");
      apiError(
        res,
        403,
        "ignore_moderator_imposed",
        "A channel moderator opted you out of TTS here, so only a moderator can undo it.",
        undefined,
        // `reason` and `ignored` are read by the viewer page to lock the toggle,
        // so they stay top-level fields rather than moving under `params`.
        { reason: "moderator_imposed", ignored: true },
      );
      return;
    }

    if (existing) {
      // Their own opt-out, so they may lift it.
      await channelDocRef.update(new FieldPath("ignoredUserIds", entryKey), FieldValue.delete());
      log.info("Removed user from TTS ignore list");
      res.json({ success: true, ignored: false, source: null, message: "Removed from TTS ignore list" });
    } else {
      // Add to ignore list, recorded as self-imposed so it stays reversible.
      await channelDocRef.set({
        ignoredUserIds: {
          [entryKey]: buildIgnoreEntry({ label: username, source: IGNORE_SOURCE_SELF, by: entryKey }),
        },
      }, { merge: true });
      log.info("Added user to TTS ignore list");
      res.json({ success: true, ignored: true, source: IGNORE_SOURCE_SELF, message: "Added to TTS ignore list" });
    }
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message }, "Error updating ignore status");
    apiError(res, 500, "ignore_update_failed", "Failed to update ignore status");
  }
});

export default router;
