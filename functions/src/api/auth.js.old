/**
 * Authentication API routes for status and token management
 */

const express = require("express");
const {db, COLLECTIONS} = require("../services/firestore");
const {getValidTwitchTokenForUser} = require("../services/twitch");
const {authenticateApiRequest} = require("../middleware/auth");
const {secrets} = require("../config");
const {logger} = require("../logger");

// eslint-disable-next-line new-cap
const router = express.Router();

// Route: /api/auth/status
router.get("/status", authenticateApiRequest, async (req, res) => {
  const log = logger.child({endpoint: "/api/auth/status", userLogin: req.user?.userLogin});
  log.info("--- /api/auth/status HIT ---");
  log.debug({user: req.user}, "Authenticated user from middleware");

  try {
    const userDocRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(req.user.userLogin);
    const userDoc = await userDocRef.get();

    if (!userDoc.exists) {
      log.warn({userLogin: req.user.userLogin}, "User not found in managed channels");
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

    log.info({userLogin: req.user.userLogin, twitchTokenStatus}, "User auth status");

    res.json({
      success: true,
      user: req.user,
      twitchTokenStatus: twitchTokenStatus,
      needsTwitchReAuth: needsTwitchReAuth || false,
    });
  } catch (error) {
    logger.error({error: error.message}, "Error checking auth status");
    res.status(500).json({
      success: false,
      error: "Failed to check authentication status",
    });
  }
});

// Route: /api/auth/refresh
router.post("/refresh", authenticateApiRequest, async (req, res) => {
  const log = logger.child({endpoint: "/api/auth/refresh", userLogin: req.user?.userLogin});
  log.info("--- /api/auth/refresh HIT ---");

  try {
    // This will automatically refresh the token if needed
    await getValidTwitchTokenForUser(req.user.userLogin, secrets);

    log.info("Token refresh successful");
    res.json({
      success: true,
      message: "Token refreshed successfully",
    });
  } catch (error) {
    log.error({error: error.message}, "Token refresh failed");
    res.status(400).json({
      success: false,
      error: error.message,
      needsReauth: error.message.includes("re-authenticate"),
    });
  }
});

module.exports = router;
