/**
 * Channel Points Rewards API routes
 */

const express = require("express");
const axios = require("axios");
const {db, COLLECTIONS} = require("../services/firestore");
const {getValidTwitchTokenForUser} = require("../services/twitch");
const {authenticateApiRequest} = require("../middleware/auth");
const {secrets} = require("../config");
const {logger, redactSensitive} = require("../logger");

// eslint-disable-next-line new-cap
const router = express.Router();

// Utility to escape RegExp special characters
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Validate a prospective Channel Points message against channel policy
async function validateChannelPointsTestMessage(channelLogin, text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    return {ok: false, reason: "Message is empty"};
  }

  const doc = await db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelLogin).get();
  const data = doc.exists ? doc.data() : {};
  const channelPoints = data.channelPoints || {};
  const policy = channelPoints.contentPolicy || {};

  const blockLinks = policy.blockLinks !== false; // default true
  const bannedWords = Array.isArray(policy.bannedWords) ? policy.bannedWords : [];

  const trimmed = text.trim();

  // Note: Twitch enforces 500 character limit on redemption input, so we don't validate length here

  if (blockLinks) {
    const linkRegex = /(https?:\/\/\S+|\b\w+\.[a-z]{2,}\b)/i;
    if (linkRegex.test(trimmed)) {
      return {ok: false, reason: "Links are not allowed"};
    }
  }

  if (bannedWords.length > 0) {
    const lower = trimmed.toLowerCase();
    for (const word of bannedWords) {
      const w = (word || "").trim();
      if (!w) continue;
      // word boundary match, case-insensitive
      const re = new RegExp(`\\b${escapeRegExp(w)}\\b`, "i");
      if (re.test(lower)) {
        return {ok: false, reason: `Contains banned word: "${w}"`};
      }
    }
  }

  return {ok: true};
}

/**
 * Ensures a TTS channel point reward exists for a channel
 * @param {string} channelLogin - The channel login
 * @param {string} twitchUserId - The Twitch user ID
 * @return {Promise<Object>} Result with status and rewardId
 */
async function ensureTtsChannelPointReward(channelLogin, twitchUserId) {
  if (!secrets.TWITCH_CLIENT_ID) {
    throw new Error("Server configuration error: missing TWITCH_CLIENT_ID");
  }

  // Acquire broadcaster token with required scopes
  const accessToken = await getValidTwitchTokenForUser(channelLogin, secrets);

  const helix = axios.create({
    baseURL: "https://api.twitch.tv/helix",
    headers: {
      "Client-ID": secrets.TWITCH_CLIENT_ID,
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });

  const desiredTitle = "Text-to-Speech Message";
  const desiredBody = {
    title: desiredTitle,
    cost: 500,
    prompt: "Enter a message to be read aloud by the TTS bot",
    is_user_input_required: true,
    should_redemptions_skip_request_queue: true,
    is_enabled: true,
  };

  // First, see if we already have a stored reward id
  let storedRewardId = null;
  try {
    const ttsDoc = await db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelLogin).get();
    if (ttsDoc.exists) {
      storedRewardId = ttsDoc.data().channelPointRewardId || null;
    }
  } catch (e) {
    logger.warn({channelLogin, error: e.message}, "[ensureTtsChannelPointReward] Could not read ttsChannelConfigs");
  }

  // Helper to upsert the Firestore record
  const setFirestoreReward = async (rewardId) => {
    await db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelLogin).set({
      // New structured config
      channelPoints: {
        enabled: false,
        rewardId: rewardId,
        title: desiredBody.title,
        cost: desiredBody.cost,
        prompt: desiredBody.prompt,
        skipQueue: !!desiredBody.should_redemptions_skip_request_queue,
        cooldownSeconds: 0,
        perStreamLimit: 0,
        perUserPerStreamLimit: 0,
        contentPolicy: {
          blockLinks: true,
          bannedWords: [],
        },
        lastSyncedAt: Date.now(),
      },
      // Legacy fields for backward compatibility (to be phased out)
      channelPointRewardId: rewardId,
      channelPointsEnabled: false,
    }, {merge: true});
  };

  // If we have an ID, try to update to desired settings for idempotency
  if (storedRewardId) {
    try {
      await helix.patch(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(twitchUserId)}&id=${encodeURIComponent(storedRewardId)}`, desiredBody);
      await setFirestoreReward(storedRewardId);
      return {status: "updated", rewardId: storedRewardId};
    } catch (e) {
      logger.warn({
        channelLogin,
        status: e?.response?.status,
        error: e?.message,
        responseData: redactSensitive(e?.response?.data),
      }, "[ensureTtsChannelPointReward] Update existing reward failed");
      // Fall through to search/create
    }
  }

  // Query existing manageable rewards and try to find by title
  try {
    const listResp = await helix.get(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(twitchUserId)}&only_manageable_rewards=true`);
    const rewards = Array.isArray(listResp.data?.data) ? listResp.data.data : [];
    const existing = rewards.find((r) => r.title === desiredTitle);
    if (existing) {
      // Update to desired settings in case they differ
      try {
        await helix.patch(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(twitchUserId)}&id=${encodeURIComponent(existing.id)}`, desiredBody);
      } catch (_e) {
        // Non-fatal if update fails; we can still use the reward as-is
        logger.warn({channelLogin, rewardId: existing.id}, "[ensureTtsChannelPointReward] Failed to update existing reward");
      }
      await setFirestoreReward(existing.id);
      return {status: "reused", rewardId: existing.id};
    }
  } catch (e) {
    logger.warn({
      channelLogin,
      status: e?.response?.status,
      error: e?.message,
      responseData: redactSensitive(e?.response?.data),
    }, "[ensureTtsChannelPointReward] Listing rewards failed");
  }

  // Create new reward
  try {
    const createResp = await helix.post(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(twitchUserId)}`, desiredBody);
    const newReward = Array.isArray(createResp.data?.data) && createResp.data.data.length > 0 ? createResp.data.data[0] : null;
    if (newReward?.id) {
      await setFirestoreReward(newReward.id);
      return {status: "created", rewardId: newReward.id};
    }
    throw new Error("No reward data returned from Twitch");
  } catch (e) {
    logger.error({
      channelLogin,
      status: e?.response?.status,
      error: e?.message,
      responseData: redactSensitive(e?.response?.data),
    }, "[ensureTtsChannelPointReward] Create new reward failed");
    throw new Error("Failed to create TTS channel point reward");
  }
}


// GET current TTS reward config and Twitch status
router.get("/tts", authenticateApiRequest, async (req, res) => {
  const channelLogin = req.user.userLogin;
  const log = logger.child({endpoint: "GET /api/rewards/tts", channelLogin});

  try {
    const doc = await db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelLogin).get();
    const data = doc.exists ? doc.data() : {};
    const channelPoints = data.channelPoints || null;

    let twitchStatus = null;
    if (channelPoints?.rewardId) {
      try {
        const accessToken = await getValidTwitchTokenForUser(channelLogin, secrets);
        const helix = axios.create({
          baseURL: "https://api.twitch.tv/helix",
          headers: {"Client-ID": secrets.TWITCH_CLIENT_ID, "Authorization": `Bearer ${accessToken}`},
          timeout: 10000,
        });
        const broadcasterId = data.twitchUserId || req.user.userId; // fallback to JWT user id
        const resp = await helix.get(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(broadcasterId)}&id=${encodeURIComponent(channelPoints.rewardId)}`);
        twitchStatus = Array.isArray(resp.data?.data) && resp.data.data.length > 0 ? resp.data.data[0] : null;
      } catch (e) {
        log.warn({
          status: e.response?.status,
          error: e.message,
          responseData: redactSensitive(e.response?.data),
        }, "Twitch lookup failed");
      }
    }

    return res.json({success: true, channelPoints, twitchStatus});
  } catch (error) {
    log.error({error: error.message}, "Error getting reward config");
    res.status(500).json({success: false, error: "Failed to load reward config"});
  }
});

// Shared handler to create or update TTS reward and persist config
async function handleUpsertTtsReward(req, res) {
  const channelLogin = req.user.userLogin;
  const broadcasterId = req.user.userId;
  const log = logger.child({endpoint: `${req.method} /api/rewards/tts`, channelLogin});

  try {
    const body = req.body || {};

    // Normalize and validate incoming config minimally (server-side)
    const enabled = !!body.enabled;
    const title = (body.title || "Text-to-Speech Message").toString().slice(0, 45);
    const cost = Math.max(1, Math.min(999999, parseInt(body.cost || 500, 10)));
    const prompt = (body.prompt || "Enter a message to be read aloud").toString().slice(0, 100);
    const skipQueue = body.skipQueue !== false;
    const rawCooldown = parseInt(body.cooldownSeconds ?? 0, 10);
    const rawPerStream = parseInt(body.perStreamLimit ?? 0, 10);
    const rawPerUser = parseInt(body.perUserPerStreamLimit ?? 0, 10);

    // Interpret empty/NaN as 0 (disabled for per-stream/per-user)
    const perStreamLimit = Number.isFinite(rawPerStream) ? Math.max(0, Math.min(1000, rawPerStream)) : 0;
    const perUserPerStreamLimit = Number.isFinite(rawPerUser) ? Math.max(0, Math.min(1000, rawPerUser)) : 0;
    // For cooldown: when limits are enabled, we enforce minimum 1; when disabled, allow 0
    const limitsEnabled = body.limitsEnabled === true;
    const cooldownSeconds = Number.isFinite(rawCooldown) ? Math.max(limitsEnabled ? 1 : 0, Math.min(3600, rawCooldown)) : (limitsEnabled ? 1 : 0);
    const contentPolicy = {
      blockLinks: body.contentPolicy?.blockLinks !== false,
      bannedWords: Array.isArray(body.contentPolicy?.bannedWords) ? body.contentPolicy.bannedWords.slice(0, 100) : [],
    };

    // Get existing config
    const existingDoc = await db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelLogin).get();
    const existingData = existingDoc.exists ? existingDoc.data() : {};
    const existingChannelPoints = existingData.channelPoints || {};
    const rewardId = existingChannelPoints.rewardId;

    let finalRewardId = rewardId;

    // If enabling and no reward exists, create one
    if (enabled && !rewardId) {
      const result = await ensureTtsChannelPointReward(channelLogin, broadcasterId);
      finalRewardId = result.rewardId;
    }

    // If we have a reward ID, sync settings to Twitch
    if (finalRewardId) {
      try {
        const accessToken = await getValidTwitchTokenForUser(channelLogin, secrets);
        const helix = axios.create({
          baseURL: "https://api.twitch.tv/helix",
          headers: {
            "Client-ID": secrets.TWITCH_CLIENT_ID,
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          timeout: 10000,
        });

        const normalizedCooldown = cooldownSeconds > 0 ? cooldownSeconds : 1;
        const effectiveGlobalEnabled = limitsEnabled && cooldownSeconds > 0;
        // Per Twitch 400 error, if we specify either is_max_per_stream_enabled or max_per_stream, both must be present.
        // Always send both fields; use a safe default of 1 when disabled or unset.
        const normalizedPerStream = perStreamLimit > 0 ? perStreamLimit : 0;
        const effectivePerStreamEnabled = limitsEnabled && perStreamLimit > 0;
        const normalizedPerUser = perUserPerStreamLimit > 0 ? perUserPerStreamLimit : 0;
        const effectivePerUserEnabled = limitsEnabled && perUserPerStreamLimit > 0;

        const twitchUpdateBody = {
          title,
          cost,
          prompt,
          is_enabled: enabled,
          should_redemptions_skip_request_queue: skipQueue,
          // Cooldown and limits must include the corresponding enable flags per Twitch docs
          is_global_cooldown_enabled: limitsEnabled ? !!effectiveGlobalEnabled : false,
          global_cooldown_seconds: normalizedCooldown,
          is_max_per_stream_enabled: limitsEnabled ? !!effectivePerStreamEnabled : false,
          max_per_stream: normalizedPerStream,
          is_max_per_user_per_stream_enabled: limitsEnabled ? !!effectivePerUserEnabled : false,
          max_per_user_per_stream: normalizedPerUser,
        };

        await helix.patch(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(broadcasterId)}&id=${encodeURIComponent(finalRewardId)}`, twitchUpdateBody);
        log.info({rewardId: finalRewardId}, "Updated Twitch reward");
      } catch (twitchError) {
        const errorMessage = twitchError.response?.data?.message || twitchError.message;
        const errorStatus = twitchError.response?.status;
        log.error({
          status: errorStatus,
          error: errorMessage,
          responseData: redactSensitive(twitchError.response?.data),
        }, "Failed to update Twitch reward");

        // If reward not found (404), create a new one if we're enabling
        if (errorStatus === 404 && enabled) {
          log.info("Reward not found, creating new reward");
          try {
            const result = await ensureTtsChannelPointReward(channelLogin, broadcasterId);
            finalRewardId = result.rewardId;
            log.info({rewardId: finalRewardId}, "Created new reward");
          } catch (createError) {
            log.error({error: createError.message}, "Failed to create new reward");
            return res.status(500).json({
              success: false,
              error: "Failed to create new Channel Points reward",
              details: createError.message,
            });
          }
        } else {
          // Provide helpful error messages for common issues
          let userFriendlyMessage = `Failed to update Twitch reward: ${errorMessage}`;
          if (errorStatus === 403 && errorMessage.includes("Client-Id header must match")) {
            userFriendlyMessage = "The reward was created with a different client ID. Please delete the reward and create a new one.";
          }

          // Return error to frontend so user knows the update failed
          return res.status(errorStatus || 500).json({
            success: false,
            error: userFriendlyMessage,
            details: twitchError.response?.data,
          });
        }
      }
    }

    // Update Firestore configuration
    const updatedChannelPoints = {
      enabled,
      rewardId: finalRewardId,
      title,
      cost,
      prompt,
      skipQueue,
      cooldownSeconds,
      perStreamLimit,
      perUserPerStreamLimit,
      contentPolicy,
      limitsEnabled,
      lastSyncedAt: Date.now(),
    };

    await db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelLogin).set({
      channelPoints: updatedChannelPoints,
      // Legacy fields for backward compatibility
      channelPointRewardId: finalRewardId,
      channelPointsEnabled: enabled,
    }, {merge: true});

    log.info({enabled, rewardId: finalRewardId}, "Updated config");

    return res.json({
      success: true,
      channelPoints: updatedChannelPoints,
      message: enabled ? "Channel point reward configured successfully" : "Channel point reward disabled",
    });
  } catch (error) {
    log.error({error: error.message}, "Error in handleUpsertTtsReward");

    if (error.message.includes("re-authenticate")) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
        needsReauth: true,
        message: "Please re-authenticate with Twitch to manage channel point rewards",
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to configure channel point reward",
      message: error.message,
    });
  }
}

// POST create or update TTS reward and persist config
router.post("/tts", authenticateApiRequest, handleUpsertTtsReward);
// Allow PUT for idempotent updates (front-end refactor compatibility)
router.put("/tts", authenticateApiRequest, handleUpsertTtsReward);

// DELETE TTS reward
router.delete("/tts", authenticateApiRequest, async (req, res) => {
  const channelLogin = req.user.userLogin;
  const log = logger.child({endpoint: "DELETE /api/rewards/tts", channelLogin});

  try {
    // Load current config
    const doc = await db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelLogin).get();
    const data = doc.exists ? doc.data() : {};
    const rewardId = data.channelPoints?.rewardId || data.channelPointRewardId;

    let twitchDeleted = false;
    if (rewardId) {
      try {
        // Delete on Twitch using Helix Delete Custom Reward
        const accessToken = await getValidTwitchTokenForUser(channelLogin, secrets);
        const userDoc = await db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(channelLogin).get();
        const twitchUserId = userDoc.exists ? userDoc.data().twitchUserId : null;
        if (twitchUserId) {
          const helix = axios.create({
            baseURL: "https://api.twitch.tv/helix",
            headers: {
              "Client-ID": secrets.TWITCH_CLIENT_ID,
              "Authorization": `Bearer ${accessToken}`,
            },
            timeout: 10000,
          });
          await helix.delete(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(twitchUserId)}&id=${encodeURIComponent(rewardId)}`);
          twitchDeleted = true;
        }
      } catch (twitchError) {
        // If Twitch deletion fails due to permission or already-deleted, we still proceed to clear local state
        log.warn({
          status: twitchError.response?.status,
          error: twitchError.message,
          responseData: redactSensitive(twitchError.response?.data),
        }, "Twitch delete failed");
      }
    }

    // Disable locally and only clear stored reward id if Twitch confirmed deletion
    await db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelLogin).set({
      channelPoints: {
        ...(data.channelPoints || {}),
        enabled: false,
        rewardId: twitchDeleted ? null : (data.channelPoints?.rewardId || null),
        lastSyncedAt: Date.now(),
      },
      // keep legacy flags consistent
      channelPointsEnabled: false,
      channelPointRewardId: twitchDeleted ? null : (data.channelPointRewardId || null),
    }, {merge: true});

    res.json({
      success: true,
      twitchDeleted,
      message: twitchDeleted ? "Disabled & deleted reward" : "Disabled locally; delete may require re-auth or manual removal",
    });
  } catch (error) {
    log.error({error: error.message}, "Error deleting TTS reward");
    res.status(500).json({
      success: false,
      error: "Failed to disable/delete TTS reward",
    });
  }
});

// POST test TTS reward
router.post("/tts/test", authenticateApiRequest, async (req, res) => {
  const channelLogin = req.user.userLogin;
  const log = logger.child({endpoint: "POST /api/rewards/tts:test", channelLogin});

  try {
    const text = (req.body?.text ?? "").toString();

    const result = await validateChannelPointsTestMessage(channelLogin, text);
    log.info("Test requested");

    if (!result.ok) {
      return res.status(400).json({success: false, error: result.reason});
    }

    res.json({success: true, message: "TTS test validated"});
  } catch (error) {
    log.error({error: error.message}, "Error testing TTS reward");
    res.status(500).json({
      success: false,
      error: "Failed to test TTS reward",
    });
  }
});

// Legacy alias to accept colon-based route used by older dashboard builds
router.post("/tts:test", authenticateApiRequest, async (req, res) => {
  const channelLogin = req.user.userLogin;
  const log = logger.child({endpoint: "POST /api/rewards/tts:test (legacy)", channelLogin});

  try {
    const text = (req.body?.text ?? "").toString();
    const result = await validateChannelPointsTestMessage(channelLogin, text);
    log.info("Test requested (legacy alias)");
    if (!result.ok) {
      return res.status(400).json({success: false, error: result.reason});
    }
    res.json({success: true, message: "TTS test validated"});
  } catch (error) {
    log.error({error: error.message}, "Error testing TTS reward (legacy)");
    res.status(500).json({success: false, error: "Failed to test TTS reward"});
  }
});

module.exports = router;
