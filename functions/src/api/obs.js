/**
 * OBS integration API routes
 */

const express = require("express");
const crypto = require("crypto");
const {db, FieldValue, COLLECTIONS} = require("../services/firestore");
const {getValidTwitchTokenForUser} = require("../services/twitch");
const {authenticateApiRequest} = require("../middleware/auth");
const {secrets, config, secretManagerClient} = require("../config");

// eslint-disable-next-line new-cap
const router = express.Router();

// Route: /api/obs/getToken
router.get("/getToken", authenticateApiRequest, async (req, res) => {
  const channelLogin = req.user.userLogin;
  console.log(`[API /obs/getToken] OBS token retrieval requested for ${channelLogin}`);

  if (!db || !secretManagerClient) {
    console.error("[API /obs/getToken] Firestore or Secret Manager client not initialized!");
    return res.status(500).json({success: false, message: "Server configuration error."});
  }

  try {
    // Check if user has valid Twitch tokens
    try {
      await getValidTwitchTokenForUser(channelLogin, secrets);
      console.log(`[API /obs/getToken] Verified valid Twitch token for ${channelLogin}`);
    } catch (tokenError) {
      console.error(`[API /obs/getToken] Token validation failed for ${channelLogin}:`, tokenError.message);
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

        console.log(`[API /obs/getToken] Retrieved existing OBS token (from ttsChannelConfigs) for ${channelLogin}`);
        return res.json({
          success: true,
          token: existingToken,
          browserSourceUrl: `${config.OBS_BROWSER_BASE_URL}/?channel=${encodeURIComponent(channelLogin)}&token=${existingToken}`,
        });
      } catch (secretError) {
        console.warn(`[API /obs/getToken] Failed to retrieve existing token from ttsChannelConfigs for ${channelLogin}:`, secretError.message);
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

        console.log(`[API /obs/getToken] Retrieved existing OBS token (from managedChannels) for ${channelLogin}`);
        return res.json({
          success: true,
          token: existingToken,
          browserSourceUrl: `${config.OBS_BROWSER_BASE_URL}/?channel=${encodeURIComponent(channelLogin)}&token=${existingToken}`,
        });
      } catch (secretError) {
        console.warn(`[API /obs/getToken] Failed legacy retrieval from managedChannels for ${channelLogin}:`, secretError.message);
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

      console.log(`[API /obs/getToken] Generated new OBS token for ${channelLogin}`);

      res.json({
        success: true,
        token: obsToken,
        browserSourceUrl: `${config.OBS_BROWSER_BASE_URL}/?channel=${encodeURIComponent(channelLogin)}&token=${obsToken}`,
      });
    } catch (error) {
      console.error(`[API /obs/getToken] Failed to store OBS token for ${channelLogin}:`, error);
      res.status(500).json({
        success: false,
        message: "Failed to generate OBS token. Please try again.",
      });
    }
  } catch (error) {
    console.error(`[API /obs/getToken] Error for ${channelLogin}:`, error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve OBS token.",
    });
  }
});

// Route: /api/obs/generateToken
router.post("/generateToken", authenticateApiRequest, async (req, res) => {
  const channelLogin = req.user.userLogin;
  console.log(`[API /obs/generateToken] OBS token generation requested for ${channelLogin}`);

  if (!db || !secretManagerClient) {
    console.error("[API /obs/generateToken] Firestore or Secret Manager client not initialized!");
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

    console.log(`[API /obs/generateToken] Generated new OBS token for ${channelLogin}`);

    res.json({
      success: true,
      token: obsToken,
      browserSourceUrl: `${config.OBS_BROWSER_BASE_URL}/?channel=${encodeURIComponent(channelLogin)}&token=${obsToken}`,
      message: "New OBS token generated successfully",
    });
  } catch (error) {
    console.error(`[API /obs/generateToken] Error for ${channelLogin}:`, error);
    res.status(500).json({
      success: false,
      message: "Failed to generate new OBS token.",
    });
  }
});

module.exports = router;
