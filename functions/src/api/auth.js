/**
 * Authentication API routes for status and token management
 */

const express = require("express");
const {db, COLLECTIONS} = require("../services/firestore");
const {getValidTwitchTokenForUser} = require("../services/twitch");
const {authenticateApiRequest} = require("../middleware/auth");
const {secrets} = require("../config");

// eslint-disable-next-line new-cap
const router = express.Router();

// Route: /api/auth/status
router.get("/status", authenticateApiRequest, async (req, res) => {
  console.log("--- /api/auth/status HIT ---");
  console.log("Authenticated user from middleware:", req.user);

  try {
    const userDocRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(req.user.userLogin);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      console.log(`User ${req.user.userLogin} not found in managed channels.`);
      return res.json({
        success: true,
        user: req.user,
        twitchTokenStatus: "not_found",
        needsTwitchReAuth: true,
      });
    }

    const userData = userDoc.data();
    const {needsTwitchReAuth, twitchAccessTokenExpiresAt} = userData;

    let twitchTokenStatus = "valid";
    if (needsTwitchReAuth) {
      twitchTokenStatus = "needs_reauth";
    } else if (twitchAccessTokenExpiresAt) {
      const expiresAt = twitchAccessTokenExpiresAt.toDate();
      const now = new Date();
      if (expiresAt <= now) {
        twitchTokenStatus = "expired";
      }
    }

    console.log(`User ${req.user.userLogin} auth status: ${twitchTokenStatus}`);

    res.json({
      success: true,
      user: req.user,
      twitchTokenStatus: twitchTokenStatus,
      needsTwitchReAuth: needsTwitchReAuth || false,
    });
  } catch (error) {
    console.error("Error checking auth status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to check authentication status",
    });
  }
});

// Route: /api/auth/refresh
router.post("/refresh", authenticateApiRequest, async (req, res) => {
  console.log("--- /api/auth/refresh HIT ---");

  try {
    // This will automatically refresh the token if needed
    await getValidTwitchTokenForUser(req.user.userLogin, secrets);

    console.log(`Token refresh successful for ${req.user.userLogin}`);
    res.json({
      success: true,
      message: "Token refreshed successfully",
    });
  } catch (error) {
    console.error(`Token refresh failed for ${req.user.userLogin}:`, error.message);
    res.status(400).json({
      success: false,
      error: error.message,
      needsReauth: error.message.includes("re-authenticate"),
    });
  }
});

module.exports = router;