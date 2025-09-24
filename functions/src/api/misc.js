/**
 * Miscellaneous API routes (shortlinks, TTS test, etc.)
 */

const express = require("express");
const Replicate = require("replicate");
const {db, COLLECTIONS} = require("../services/firestore");
const {createShortLink, normalizeEmotion} = require("../services/utils");
const {authenticateApiRequest} = require("../middleware/auth");
const {secrets, config} = require("../config");

// Separate routers for API endpoints and public redirects
// eslint-disable-next-line new-cap
const apiRouter = express.Router();
// eslint-disable-next-line new-cap
const redirectRouter = express.Router();

// Route: /api/shortlink - Create a short link (requires app/viewer JWT)
apiRouter.post("/shortlink", authenticateApiRequest, async (req, res) => {
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
    console.error("[POST /api/shortlink] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Route: /s/:slug - Redirect short link (public)
redirectRouter.get("/s/:slug", async (req, res) => {
  try {
    const {slug} = req.params;

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
      console.warn("Failed to update click counter:", updateError);
    }

    console.log(`[GET /s/:slug] Redirecting ${slug} to ${url}`);
    res.redirect(301, url);
  } catch (error) {
    console.error("[GET /s/:slug] Error:", error);
    res.status(500).send("Internal server error");
  }
});

// Route: /api/tts/test - Test TTS functionality
apiRouter.post("/tts/test", authenticateApiRequest, async (req, res) => {
  try {
    const {text, voiceId, emotion, pitch, speed, languageBoost, channel} = req.body || {};
    const channelLogin = req.user.userLogin;

    if (!text) {
      return res.status(400).json({
        success: false,
        error: "Text is required for TTS test",
      });
    }

    console.log(`[POST /api/tts/test] TTS test requested for ${channelLogin}: "${text}" with voice ${voiceId || "default"}`);

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
      console.log("[POST /api/tts/test] Effective params:", effective);
    } catch (resolveErr) {
      console.warn("[POST /api/tts/test] Failed to resolve defaults; proceeding with request values only:", resolveErr.message);
    }

    // If configured, generate audio via Replicate (minimax/speech-02-turbo)
    if (secrets.REPLICATE_API_TOKEN) {
      try {
        // eslint-disable-next-line new-cap
        const replicate = new Replicate({auth: secrets.REPLICATE_API_TOKEN});
        console.log("Replicate client initialized for TTS test ✓");

        const input = {text, format: "mp3"};
        // Voice: pass common synonyms used by providers so one takes effect
        if (effective.voiceId) {
          input.voice = effective.voiceId; // common
          input.voice_id = effective.voiceId; // some schemas
          input.speaker = effective.voiceId; // alt key
        }
        // Speed / rate
        if (typeof effective.speed === "number") {
          input.speed = effective.speed; // common
          input.speed_scale = effective.speed; // alt key
          input.rate = effective.speed; // alt key
        }
        // Pitch (in semitones)
        if (typeof effective.pitch === "number") {
          input.pitch = effective.pitch; // common
          input.pitch_semitones = effective.pitch; // alt key
        }
        // Emotion/Style
        if (effective.emotion) {
          input.emotion = effective.emotion; // common
          input.style = effective.emotion; // alt key
        }
        // Language
        if (effective.languageBoost) {
          input.language = effective.languageBoost; // common
          input.language_boost = effective.languageBoost; // alt key
        }

        const result = await replicate.run("minimax/speech-02-turbo", {input});

        let audioUrl = null;
        if (typeof result === "string") {
          audioUrl = result;
        } else if (Array.isArray(result)) {
          audioUrl = result[0];
        } else if (result) {
          audioUrl = result.audioUrl || result.audio_url || result.url || result.audio ||
            (Array.isArray(result.output) ? result.output[0] : (result.output?.audio || result.output?.audio_url || result.output?.url || result.output));
        }

        if (audioUrl && typeof audioUrl === "string") {
          return res.json({success: true, audioUrl, provider: "replicate", model: "minimax/speech-02-turbo"});
        }

        console.warn("[POST /api/tts/test] Replicate returned no audio URL. Raw result:", typeof result, result);
        return res.status(502).json({success: false, error: "No audio URL returned by TTS provider"});
      } catch (replicateError) {
        console.error("[POST /api/tts/test] Replicate call failed:", replicateError?.response?.data || replicateError.message || replicateError);
        // Fall through to generic response so frontend still gets clear error message
        return res.status(500).json({success: false, error: "TTS generation failed"});
      }
    }

    // Fallback when Replicate is not configured
    return res.status(501).json({success: false, error: "TTS provider not configured"});
  } catch (error) {
    console.error("[POST /api/tts/test] Error:", error);
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
