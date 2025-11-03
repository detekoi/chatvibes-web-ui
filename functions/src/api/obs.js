/**
 * OBS integration API routes
 */

const express = require("express");
const crypto = require("crypto");
const {db, FieldValue, COLLECTIONS} = require("../services/firestore");
const {getValidTwitchTokenForUser} = require("../services/twitch");
const {authenticateApiRequest} = require("../middleware/auth");
const {secrets, config, secretManagerClient} = require("../config");
const {logger, redactSensitive} = require("../logger");

// eslint-disable-next-line new-cap
const router = express.Router();

// Route: /api/obs/getToken
router.get("/getToken", authenticateApiRequest, async (req, res) => {
  const channelLogin = req.user.userLogin;
  const log = logger.child({endpoint: "/api/obs/getToken", channelLogin});
  log.info("OBS token retrieval requested");

  if (!db || !secretManagerClient) {
    log.error("Firestore or Secret Manager client not initialized!");
    return res.status(500).json({success: false, message: "Server configuration error."});
  }

  try {
    // Check if user has valid Twitch tokens
    try {
      await getValidTwitchTokenForUser(channelLogin, secrets);
      log.debug("Verified valid Twitch token");
    } catch (tokenError) {
      log.error({error: tokenError.message}, "Token validation failed");
      return res.status(403).json({
        success: false,
        needsReAuth: true,
        message: "Your Twitch authentication has expired. Please reconnect your account.",
      });
    }

    // Attempt to read secret reference from the TTS config (source of truth)
    const ttsDocRef = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelLogin);
    const ttsDoc = await ttsDocRef.get();

    if (ttsDoc.exists && ttsDoc.data().obsSocketSecretName) {
      try {
        const [version] = await secretManagerClient.accessSecretVersion({
          name: ttsDoc.data().obsSocketSecretName,
        });
        const existingToken = version.payload.data.toString().trim();

        log.info("Retrieved existing OBS token (from ttsChannelConfigs)");
        return res.json({
          success: true,
          token: existingToken,
          browserSourceUrl: `${config.OBS_BROWSER_BASE_URL}/?channel=${encodeURIComponent(channelLogin)}&token=${existingToken}`,
        });
      } catch (secretError) {
        log.warn({error: secretError.message}, "Failed to retrieve existing token from ttsChannelConfigs");
        // Fall through to legacy check or generate new token
      }
    }

    // Legacy fallback: check managedChannels for obsTokenSecretName
    const userDocRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(channelLogin);
    const userDoc = await userDocRef.get();

    if (userDoc.exists && userDoc.data().obsTokenSecretName) {
      try {
        const [version] = await secretManagerClient.accessSecretVersion({
          name: userDoc.data().obsTokenSecretName,
        });
        const existingToken = version.payload.data.toString().trim();

        log.info("Retrieved existing OBS token (from managedChannels)");
        return res.json({
          success: true,
          token: existingToken,
          browserSourceUrl: `${config.OBS_BROWSER_BASE_URL}/?channel=${encodeURIComponent(channelLogin)}&token=${existingToken}`,
        });
      } catch (secretError) {
        log.warn({error: secretError.message}, "Failed legacy retrieval from managedChannels");
        // Continue to generate new token
      }
    }

    // Generate new OBS token
    const obsToken = crypto.randomBytes(32).toString("hex");
    const secretName = `projects/${config.GCLOUD_PROJECT}/secrets/obs-token-${channelLogin}`;

    try {
      // Create secret if it doesn't exist
      try {
        await secretManagerClient.createSecret({
          parent: `projects/${config.GCLOUD_PROJECT}`,
          secretId: `obs-token-${channelLogin}`,
          secret: {
            replication: {automatic: {}},
          },
        });
      } catch (createError) {
        if (!createError.message.includes("already exists")) {
          throw createError;
        }
      }

      // Add secret version
      await secretManagerClient.addSecretVersion({
        parent: secretName,
        payload: {
          data: Buffer.from(obsToken),
        },
      });

      // Update user document with secret reference
      await userDocRef.update({
        obsTokenSecretName: `${secretName}/versions/latest`,
        obsTokenGeneratedAt: new Date(),
      });

      log.info("Generated new OBS token");

      res.json({
        success: true,
        token: obsToken,
        browserSourceUrl: `${config.OBS_BROWSER_BASE_URL}/?channel=${encodeURIComponent(channelLogin)}&token=${obsToken}`,
      });
    } catch (error) {
      log.error({error: error.message}, "Failed to store OBS token");
      res.status(500).json({
        success: false,
        message: "Failed to generate OBS token. Please try again.",
      });
    }
  } catch (error) {
    log.error({error: error.message}, "Error retrieving OBS token");
    res.status(500).json({
      success: false,
      message: "Failed to retrieve OBS token.",
    });
  }
});

// Route: /api/obs/generateToken
router.post("/generateToken", authenticateApiRequest, async (req, res) => {
  const channelLogin = req.user.userLogin;
  const log = logger.child({endpoint: "/api/obs/generateToken", channelLogin});
  log.info("OBS token generation requested");

  if (!db || !secretManagerClient) {
    log.error("Firestore or Secret Manager client not initialized!");
    return res.status(500).json({success: false, message: "Server configuration error."});
  }

  try {
    // Verify valid Twitch token
    try {
      await getValidTwitchTokenForUser(channelLogin, secrets);
    } catch (tokenError) {
      return res.status(403).json({
        success: false,
        needsReAuth: true,
        message: "Your Twitch authentication has expired. Please reconnect your account.",
      });
    }

    // Generate new OBS token
    const obsToken = crypto.randomBytes(32).toString("hex");
    const secretName = `projects/${config.GCLOUD_PROJECT}/secrets/obs-token-${channelLogin}`;

    // Create or update secret
    try {
      await secretManagerClient.createSecret({
        parent: `projects/${config.GCLOUD_PROJECT}`,
        secretId: `obs-token-${channelLogin}`,
        secret: {
          replication: {automatic: {}},
        },
      });
    } catch (createError) {
      if (!createError.message.includes("already exists")) {
        throw createError;
      }
    }

    await secretManagerClient.addSecretVersion({
      parent: secretName,
      payload: {
        data: Buffer.from(obsToken),
      },
    });

    // Store the secret name in the TTS channel config (source of truth)
    const fullSecretName = `${secretName}/versions/latest`;
    const ttsDocRef2 = db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channelLogin);
    await ttsDocRef2.set({
      obsSocketSecretName: fullSecretName,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});

    // Optionally update the managedChannels document for auditing
    const userDocRef2 = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(channelLogin);
    await userDocRef2.set({
      obsTokenGeneratedAt: new Date(),
    }, {merge: true});

    log.info("Generated new OBS token");

    res.json({
      success: true,
      token: obsToken,
      browserSourceUrl: `${config.OBS_BROWSER_BASE_URL}/?channel=${encodeURIComponent(channelLogin)}&token=${obsToken}`,
      message: "New OBS token generated successfully",
    });
  } catch (error) {
    log.error({error: error.message}, "Error generating OBS token");
    res.status(500).json({
      success: false,
      message: "Failed to generate new OBS token.",
    });
  }
});

module.exports = router;
