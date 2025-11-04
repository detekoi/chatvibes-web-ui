/**
 * Miscellaneous API routes (shortlinks, TTS test, etc.)
 */

const express = require("express");
const axios = require("axios");
const {db, COLLECTIONS} = require("../services/firestore");
const {createShortLink, normalizeEmotion} = require("../services/utils");
const {authenticateApiRequest} = require("../middleware/auth");
const {secrets, config} = require("../config");
const {logger, redactSensitive} = require("../logger");

// Separate routers for API endpoints and public redirects
// eslint-disable-next-line new-cap
const apiRouter = express.Router();
// eslint-disable-next-line new-cap
const redirectRouter = express.Router();

// Route: /api/shortlink - Create a short link (requires app/viewer JWT)
apiRouter.post("/shortlink", authenticateApiRequest, async (req, res) => {
  const log = logger.child({endpoint: "/api/shortlink"});
  try {
    const {url} = req.body;

    if (!url) {
      return res.status(400).json({error: "URL is required"});
    }

    const slug = await createShortLink(url);

    const pathOnly = `/s/${slug}`;
    const absoluteUrl = config.FRONTEND_URL ? `${new URL(config.FRONTEND_URL).origin}${pathOnly}` : pathOnly;
    res.json({
      success: true,
      slug: slug,
      shortUrl: pathOnly,
      absoluteUrl: absoluteUrl,
    });
  } catch (error) {
    log.error({error: error.message}, "Error creating shortlink");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Route: /s/:slug - Redirect short link (public)
redirectRouter.get("/s/:slug", async (req, res) => {
  const {slug} = req.params;
  try {
    if (!slug) {
      return res.status(400).send("Invalid short link");
    }

    const shortlinkDoc = await db.collection(COLLECTIONS.SHORTLINKS).doc(slug).get();

    if (!shortlinkDoc.exists) {
      return res.status(404).send("Short link not found");
    }

    const data = shortlinkDoc.data();
    const {url} = data;

    // Increment click counter
    try {
      await shortlinkDoc.ref.update({
        clicks: (data.clicks || 0) + 1,
        lastClickedAt: new Date(),
      });
    } catch (updateError) {
      logger.warn({error: updateError.message, slug}, "Failed to update click counter");
    }

    logger.info({slug, url}, "Redirecting short link");
    res.redirect(301, url);
  } catch (error) {
    logger.error({error: error.message, slug}, "Error redirecting short link");
    res.status(500).send("Internal server error");
  }
});

// Route: /api/tts/test - Test TTS functionality
apiRouter.post("/tts/test", authenticateApiRequest, async (req, res) => {
  const {text, voiceId, emotion, pitch, speed, languageBoost, channel} = req.body || {};
  const channelLogin = req.user.userLogin;
  const log = logger.child({endpoint: "/api/tts/test", channelLogin, voiceId: voiceId || "default"});

  try {
    if (!text) {
      return res.status(400).json({
        success: false,
        error: "Text is required for TTS test",
      });
    }

    log.info({textLength: text.length}, "TTS test requested");

    // Resolve effective parameters in order: request override -> viewer global prefs -> channel defaults
    let effective = {voiceId: voiceId ?? null, emotion: normalizeEmotion(emotion), pitch: (pitch !== undefined) ? pitch : null, speed: (speed !== undefined) ? speed : null, languageBoost: languageBoost ?? null};

    try {
      // Load viewer global preferences
      const userDoc = await db.collection("ttsUserPreferences").doc(channelLogin).get();
      const userPrefs = userDoc.exists ? (userDoc.data() || {}) : {};

      // Optionally load channel defaults if a channel is provided
      let channelDefaults = {};
      if (channel) {
        const channelDoc = await db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channel).get();
        if (channelDoc.exists) {
          const d = channelDoc.data() || {};
          channelDefaults = {
            voiceId: d.voiceId ?? null,
            emotion: d.emotion ?? null,
            pitch: (d.pitch !== undefined) ? d.pitch : null,
            speed: (d.speed !== undefined) ? d.speed : null,
            languageBoost: d.languageBoost ?? null,
          };
        }
      }

      const pick = (reqVal, userVal, chanVal) => {
        if (reqVal !== undefined && reqVal !== null && reqVal !== "") return reqVal; // explicit request
        if (userVal !== undefined && userVal !== null && userVal !== "") return userVal; // viewer global
        return (chanVal !== undefined && chanVal !== null && chanVal !== "") ? chanVal : null; // channel default
      };

      effective = {
        voiceId: pick(voiceId, userPrefs.voiceId, channelDefaults.voiceId),
        emotion: normalizeEmotion(pick(emotion, userPrefs.emotion, channelDefaults.emotion)),
        pitch: pick(pitch, userPrefs.pitch, channelDefaults.pitch),
        speed: pick(speed, userPrefs.speed, channelDefaults.speed),
        languageBoost: pick(languageBoost, userPrefs.languageBoost, channelDefaults.languageBoost),
      };
      log.debug({effective}, "Effective params");
    } catch (resolveErr) {
      log.warn({error: resolveErr.message}, "Failed to resolve defaults; proceeding with request values only");
    }

    // If configured, generate audio via Wavespeed AI (minimax/speech-02-turbo)
    if (secrets.WAVESPEED_API_KEY) {
      try {
        log.debug("Wavespeed AI client initialized for TTS test");

        // Map legacy language boost values to Wavespeed format
        let languageBoost = effective.languageBoost || "auto";
        if (languageBoost === "Automatic" || languageBoost === "None") {
          languageBoost = "auto";
        }

        const input = {
          text,
          voice_id: effective.voiceId || "Friendly_Person",
          speed: typeof effective.speed === "number" ? effective.speed : 1.0,
          volume: 1.0,
          pitch: typeof effective.pitch === "number" ? effective.pitch : 0,
          emotion: effective.emotion || "neutral",
          language_boost: languageBoost,
          english_normalization: false,
          sample_rate: 32000,
          bitrate: 128000,
          channel: "1",
          format: "mp3",
          enable_sync_mode: true, // Enable sync mode for lowest latency
        };

        const response = await axios.post(
            "https://api.wavespeed.ai/api/v3/minimax/speech-02-turbo",
            input,
            {
              headers: {
                "Authorization": `Bearer ${secrets.WAVESPEED_API_KEY}`,
                "Content-Type": "application/json",
              },
              timeout: 60000, // 60 second timeout
            },
        );

        const result = response.data;
        const data = result.data || result;

        if (data.status === "completed" && data.outputs && data.outputs.length > 0) {
          const audioUrl = data.outputs[0];
          return res.json({success: true, audioUrl, provider: "wavespeed", model: "minimax/speech-02-turbo"});
        } else if (data.status === "failed") {
          log.error({error: data.error}, "Wavespeed AI returned failed status");

          // Provide specific error messages based on the failure reason
          if (data.error && data.error.includes("you don't have access to this voice_id")) {
            return res.status(403).json({
              success: false,
              error: `Voice access denied: The voice "${effective.voiceId}" requires special access permissions. Please try a different voice.`,
            });
          }

          if (data.error && data.error.includes("voice_id")) {
            return res.status(400).json({
              success: false,
              error: `Invalid voice: "${effective.voiceId}" is not available. Please check the voice ID and try again.`,
            });
          }

          return res.status(502).json({success: false, error: `TTS generation failed: ${data.error || "Unknown error"}`});
        } else {
          log.warn({data: redactSensitive(data)}, "Wavespeed AI returned unexpected status or missing outputs");
          return res.status(502).json({success: false, error: "No audio URL returned by TTS provider"});
        }
      } catch (wavespeedError) {
        log.error({
          error: wavespeedError.message,
          responseData: redactSensitive(wavespeedError?.response?.data),
        }, "Wavespeed AI call failed");

        // Provide specific error messages based on Wavespeed API response
        if (wavespeedError.response?.data) {
          const apiError = wavespeedError.response.data;

          // Check for specific Wavespeed error messages
          if (apiError.message && apiError.message.includes("you don't have access to this voice_id")) {
            return res.status(403).json({
              success: false,
              error: `Voice access denied: The voice "${effective.voiceId}" requires special access permissions. Please try a different voice.`,
            });
          }

          if (apiError.message && apiError.message.includes("voice_id")) {
            return res.status(400).json({
              success: false,
              error: `Invalid voice: "${effective.voiceId}" is not available. Please check the voice ID and try again.`,
            });
          }

          if (apiError.message) {
            return res.status(502).json({
              success: false,
              error: `TTS generation failed: ${apiError.message}`,
            });
          }
        }

        // Fallback to generic error
        return res.status(500).json({success: false, error: "TTS generation failed"});
      }
    }

    // Fallback when Wavespeed AI is not configured
    return res.status(501).json({success: false, error: "TTS provider not configured"});
  } catch (error) {
    log.error({error: error.message}, "Error in TTS test");
    res.status(500).json({
      success: false,
      error: "TTS test failed",
      message: error.message,
    });
  }
});

module.exports = {
  apiRouter,
  redirectRouter,
};
