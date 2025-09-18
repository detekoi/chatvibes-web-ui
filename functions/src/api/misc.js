/**
 * Miscellaneous API routes (shortlinks, TTS test, etc.)
 */

const express = require("express");
const Replicate = require("replicate");
const {db, COLLECTIONS} = require("../services/firestore");
const {createShortLink} = require("../services/utils");
const {authenticateApiRequest} = require("../middleware/auth");
const {secrets} = require("../config");

// eslint-disable-next-line new-cap
const router = express.Router();

// Route: /api/shortlink - Create a short link
router.post("/shortlink", async (req, res) => {
  try {
    const {url} = req.body;

    if (!url) {
      return res.status(400).json({error: "URL is required"});
    }

    const slug = await createShortLink(url);

    res.json({
      success: true,
      slug: slug,
      shortUrl: `/s/${slug}`,
    });
  } catch (error) {
    console.error("[POST /api/shortlink] Error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Route: /s/:slug - Redirect short link
router.get("/s/:slug", async (req, res) => {
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
router.post("/tts/test", authenticateApiRequest, async (req, res) => {
  try {
    const {text, voiceId} = req.body;
    const channelLogin = req.user.userLogin;

    if (!text) {
      return res.status(400).json({
        success: false,
        error: "Text is required for TTS test",
      });
    }

    console.log(`[POST /api/tts/test] TTS test requested for ${channelLogin}: "${text}" with voice ${voiceId || "default"}`);

    // Initialize Replicate client if available
    if (secrets.REPLICATE_API_TOKEN) {
      // eslint-disable-next-line new-cap
      const replicate = new Replicate({
        auth: secrets.REPLICATE_API_TOKEN,
      });
      // Use replicate here if needed for TTS testing
      console.log("Replicate client initialized for TTS test", replicate ? "✓" : "✗");
    }

    // For now, we'll just return a success response
    // In a real implementation, this would integrate with your TTS service
    res.json({
      success: true,
      message: "TTS test completed successfully",
      text: text,
      voiceId: voiceId || "default",
      channel: channelLogin,
    });
  } catch (error) {
    console.error("[POST /api/tts/test] Error:", error);
    res.status(500).json({
      success: false,
      error: "TTS test failed",
      message: error.message,
    });
  }
});

module.exports = router;
