/**
 * Miscellaneous API routes (shortlinks, TTS test, etc.)
 */

const express = require("express");
const Replicate = require("replicate");
const {db, COLLECTIONS} = require("../services/firestore");
const {createShortLink} = require("../services/utils");
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
    const {text, voiceId, emotion, pitch, speed, languageBoost} = req.body || {};
    const channelLogin = req.user.userLogin;

    if (!text) {
      return res.status(400).json({
        success: false,
        error: "Text is required for TTS test",
      });
    }

    console.log(`[POST /api/tts/test] TTS test requested for ${channelLogin}: "${text}" with voice ${voiceId || "default"}`);

    // If configured, generate audio via Replicate (minimax/speech-02-turbo)
    if (secrets.REPLICATE_API_TOKEN) {
      try {
        // eslint-disable-next-line new-cap
        const replicate = new Replicate({auth: secrets.REPLICATE_API_TOKEN});
        console.log("Replicate client initialized for TTS test ✓");

        const input = {text, format: "mp3"};
        // Voice: pass common synonyms used by providers so one takes effect
        if (voiceId) {
          input.voice = voiceId; // common
          input.voice_id = voiceId; // some schemas
          input.speaker = voiceId; // alt key
        }
        // Speed / rate
        if (typeof speed === "number") {
          input.speed = speed; // common
          input.speed_scale = speed; // alt key
          input.rate = speed; // alt key
        }
        // Pitch (in semitones)
        if (typeof pitch === "number") {
          input.pitch = pitch; // common
          input.pitch_semitones = pitch; // alt key
        }
        // Emotion/Style
        if (emotion) {
          input.emotion = emotion; // common
          input.style = emotion; // alt key
        }
        // Language
        if (languageBoost) {
          input.language = languageBoost; // common
          input.language_boost = languageBoost; // alt key
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
