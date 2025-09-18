/**
 * Channel Points Rewards API routes
 */

const express = require("express");
const axios = require("axios");
const {db, COLLECTIONS} = require("../services/firestore");
const {getValidTwitchTokenForUser} = require("../services/twitch");
const {authenticateApiRequest} = require("../middleware/auth");
const {secrets} = require("../config");

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

  const minChars = Number.isFinite(policy.minChars) ? policy.minChars : 1;
  const maxChars = Number.isFinite(policy.maxChars) ? policy.maxChars : 200;
  const blockLinks = policy.blockLinks !== false; // default true
  const bannedWords = Array.isArray(policy.bannedWords) ? policy.bannedWords : [];

  const trimmed = text.trim();
  if (trimmed.length < minChars) {
    return {ok: false, reason: `Message too short (min ${minChars})`};
  }
  if (trimmed.length > maxChars) {
    return {ok: false, reason: `Message too long (max ${maxChars})`};
  }

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
    console.warn(`[ensureTtsChannelPointReward] Could not read ttsChannelConfigs for ${channelLogin}:`, e.message);
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
          minChars: 1,
          maxChars: 200,
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
      console.warn(`[ensureTtsChannelPointReward] Update existing reward failed for ${channelLogin}:`, e?.response?.status, e?.response?.data || e?.message || e);
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
        console.warn(`[ensureTtsChannelPointReward] Failed to update existing reward ${existing.id} for ${channelLogin}`);
      }
      await setFirestoreReward(existing.id);
      return {status: "reused", rewardId: existing.id};
    }
  } catch (e) {
    console.warn(`[ensureTtsChannelPointReward] Listing rewards failed for ${channelLogin}:`, e?.response?.status, e?.response?.data || e?.message || e);
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
    console.error(`[ensureTtsChannelPointReward] Create new reward failed for ${channelLogin}:`, e?.response?.status, e?.response?.data || e?.message || e);
    throw new Error("Failed to create TTS channel point reward");
  }
}


// GET current TTS reward config and Twitch status
router.get("/tts", authenticateApiRequest, async (req, res) => {
  try {
    const channelLogin = req.user.userLogin;
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
        console.warn("[GET /api/rewards/tts] Twitch lookup failed:", e.response?.status, e.response?.data || e.message);
      }
    }

    return res.json({success: true, channelPoints, twitchStatus});
  } catch (error) {
    console.error("[GET /api/rewards/tts] Error:", error);
    res.status(500).json({success: false, error: "Failed to load reward config"});
  }
});

// POST create or update TTS reward and persist config
router.post("/tts", authenticateApiRequest, async (req, res) => {
  try {
    const channelLogin = req.user.userLogin;
    const broadcasterId = req.user.userId;
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
      minChars: Math.max(0, Math.min(500, parseInt(body.contentPolicy?.minChars ?? 1, 10))),
      maxChars: Math.max(1, Math.min(500, parseInt(body.contentPolicy?.maxChars ?? 200, 10))),
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
        console.log(`[POST /api/rewards/tts] Updated Twitch reward ${finalRewardId} for ${channelLogin}`);
      } catch (twitchError) {
        console.warn(`[POST /api/rewards/tts] Failed to update Twitch reward for ${channelLogin}:`, twitchError.response?.status, twitchError.response?.data || twitchError.message);
        // Continue with Firestore update even if Twitch update fails
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

    console.log(`[POST /api/rewards/tts] Updated config for ${channelLogin}: enabled=${enabled}, rewardId=${finalRewardId}`);

    return res.json({
      success: true,
      channelPoints: updatedChannelPoints,
      message: enabled ? "Channel point reward configured successfully" : "Channel point reward disabled",
    });
  } catch (error) {
    console.error("[POST /api/rewards/tts] Error:", error);

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
});

// DELETE TTS reward
router.delete("/tts", authenticateApiRequest, async (req, res) => {
  try {
    const channelLogin = req.user.userLogin;

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
        console.warn(`[DELETE /api/rewards/tts] Twitch delete failed for ${channelLogin}:`, twitchError.response?.status, twitchError.response?.data || twitchError.message);
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
    console.error("[DELETE /api/rewards/tts] Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to disable/delete TTS reward",
    });
  }
});

// POST test TTS reward
router.post("/tts/test", authenticateApiRequest, async (req, res) => {
  try {
    const channelLogin = req.user.userLogin;
    const text = (req.body?.text ?? "").toString();

    const result = await validateChannelPointsTestMessage(channelLogin, text);
    console.log(`[POST /api/rewards/tts:test] Test requested for ${channelLogin}`);

    if (!result.ok) {
      return res.status(400).json({success: false, error: result.reason});
    }

    res.json({success: true, message: "TTS test validated"});
  } catch (error) {
    console.error("[POST /api/rewards/tts:test] Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to test TTS reward",
    });
  }
});

// Legacy alias to accept colon-based route used by older dashboard builds
router.post("/tts:test", authenticateApiRequest, async (req, res) => {
  try {
    const channelLogin = req.user.userLogin;
    const text = (req.body?.text ?? "").toString();
    const result = await validateChannelPointsTestMessage(channelLogin, text);
    console.log(`[POST /api/rewards/tts:test] (legacy alias) Test requested for ${channelLogin}`);
    if (!result.ok) {
      return res.status(400).json({success: false, error: result.reason});
    }
    res.json({success: true, message: "TTS test validated"});
  } catch (error) {
    console.error("[POST /api/rewards/tts:test] (legacy) Error:", error);
    res.status(500).json({success: false, error: "Failed to test TTS reward"});
  }
});

module.exports = router;
