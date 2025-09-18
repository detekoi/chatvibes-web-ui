/**
 * Twitch API service module
 * Handles token management, validation, and API calls
 */

const axios = require("axios");
const {db, COLLECTIONS} = require("./firestore");
const {secretManagerClient, config} = require("../config");

// Twitch API endpoints
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
const TWITCH_HELIX_BASE = "https://api.twitch.tv/helix";

/**
 * Refreshes a Twitch access token using the refresh token
 * @param {string} currentRefreshToken - The current refresh token
 * @param {Object} secrets - The loaded secrets object
 * @return {Promise<Object>} The new tokens and expiration
 */
async function refreshTwitchToken(currentRefreshToken, secrets) {
  if (!secrets.TWITCH_CLIENT_ID || !secrets.TWITCH_CLIENT_SECRET) {
    console.error("Twitch client ID or secret not configured for token refresh.");
    throw new Error("Server configuration error for Twitch token refresh.");
  }

  console.log("Attempting to refresh Twitch token...");

  try {
    const refreshResponse = await axios.post(TWITCH_TOKEN_URL, null, {
      params: {
        client_id: secrets.TWITCH_CLIENT_ID,
        client_secret: secrets.TWITCH_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: currentRefreshToken,
      },
    });

    const {access_token: newAccessToken, refresh_token: newRefreshToken, expires_in: expiresIn} = refreshResponse.data;

    if (!newAccessToken || !newRefreshToken) {
      console.error("Missing access_token or refresh_token in refresh response.", refreshResponse.data);
      throw new Error("Twitch did not return the expected refreshed tokens.");
    }

    const expiresAt = new Date(Date.now() + (expiresIn * 1000));
    console.log(`✅ Successfully refreshed Twitch token. New token expires at: ${expiresAt.toISOString()}`);

    return {
      newAccessToken,
      newRefreshToken,
      expiresAt,
    };
  } catch (error) {
    console.error("❌ Failed to refresh Twitch token:", error.response?.data || error.message);
    throw new Error("Failed to refresh Twitch token");
  }
}

/**
 * Gets a valid Twitch access token for a user, refreshing if necessary
 * @param {string} userLogin - The user's Twitch login
 * @param {Object} secrets - The loaded secrets object
 * @return {Promise<string>} A valid access token
 */
async function getValidTwitchTokenForUser(userLogin, secrets) {
  if (!db || !secretManagerClient) {
    console.error("[getValidTwitchTokenForUser] Firestore or Secret Manager client not initialized!");
    throw new Error("Server configuration error.");
  }

  const userDocRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(userLogin);
  const userDoc = await userDocRef.get();

  if (!userDoc.exists) {
    console.error(`[getValidTwitchTokenForUser] User ${userLogin} not found in managed channels.`);
    throw new Error("User not found in managed channels.");
  }

  const userData = userDoc.data();
  const {twitchUserId, twitchAccessTokenExpiresAt, needsTwitchReAuth} = userData;

  if (needsTwitchReAuth) {
    console.error(`[getValidTwitchTokenForUser] User ${userLogin} needs to re-authenticate with Twitch.`);
    throw new Error("User needs to re-authenticate with Twitch.");
  }

  if (!twitchUserId) {
    console.error(`[getValidTwitchTokenForUser] User ${userLogin} missing twitchUserId.`);
    throw new Error("User missing Twitch user ID.");
  }

  // Check if token is still valid (5 minute buffer)
  const now = new Date();
  const expiresAt = twitchAccessTokenExpiresAt?.toDate();
  const bufferTime = 5 * 60 * 1000; // 5 minutes

  if (expiresAt && (expiresAt.getTime() - now.getTime()) > bufferTime) {
    // Token is still valid, get it from Secret Manager
    try {
      const secretName = `projects/${config.GCLOUD_PROJECT}/secrets/twitch-access-token-${twitchUserId}`;
      const [version] = await secretManagerClient.accessSecretVersion({
        name: `${secretName}/versions/latest`,
      });
      const accessToken = version.payload.data.toString().trim();
      console.log(`[getValidTwitchTokenForUser] Using existing valid token for ${userLogin}`);
      return accessToken;
    } catch (error) {
      console.warn(`[getValidTwitchTokenForUser] Failed to get access token from Secret Manager for ${userLogin}:`, error.message);
      // Continue to refresh flow
    }
  }

  // Token is expired or missing, refresh it
  console.log(`[getValidTwitchTokenForUser] Token expired or missing for ${userLogin}, refreshing...`);

  try {
    // Get refresh token from Secret Manager
    const refreshSecretName = `projects/${config.GCLOUD_PROJECT}/secrets/twitch-refresh-token-${twitchUserId}`;
    const [refreshVersion] = await secretManagerClient.accessSecretVersion({
      name: `${refreshSecretName}/versions/latest`,
    });
    const refreshToken = refreshVersion.payload.data.toString().trim();

    // Refresh the token
    const {newAccessToken, newRefreshToken, expiresAt: newExpiresAt} = await refreshTwitchToken(refreshToken, secrets);

    // Store new tokens in Secret Manager
    await Promise.all([
      secretManagerClient.addSecretVersion({
        parent: `projects/${config.GCLOUD_PROJECT}/secrets/twitch-access-token-${twitchUserId}`,
        payload: {data: Buffer.from(newAccessToken)},
      }),
      secretManagerClient.addSecretVersion({
        parent: `projects/${config.GCLOUD_PROJECT}/secrets/twitch-refresh-token-${twitchUserId}`,
        payload: {data: Buffer.from(newRefreshToken)},
      }),
    ]);

    // Update expiration in Firestore
    await userDocRef.update({
      twitchAccessTokenExpiresAt: newExpiresAt,
      lastTokenError: null,
      lastTokenErrorAt: null,
    });

    console.log(`[getValidTwitchTokenForUser] Successfully refreshed token for ${userLogin}`);
    return newAccessToken;
  } catch (error) {
    console.error(`[getValidTwitchTokenForUser] Failed to refresh token for ${userLogin}:`, error.message);

    // Mark user as needing re-auth
    await userDocRef.update({
      needsTwitchReAuth: true,
      lastTokenError: error.message,
      lastTokenErrorAt: new Date(),
    });

    throw new Error("Token refresh failed, user needs to re-authenticate");
  }
}

/**
 * Validates a Twitch access token
 * @param {string} accessToken - The access token to validate
 * @return {Promise<Object>} The validation response data
 */
async function validateTwitchToken(accessToken) {
  try {
    const response = await axios.get(TWITCH_VALIDATE_URL, {
      headers: {Authorization: `OAuth ${accessToken}`},
    });
    return response.data;
  } catch (error) {
    console.error("Failed to validate Twitch token:", error.response?.data || error.message);
    throw new Error("Token validation failed");
  }
}

/**
 * Makes a Twitch Helix API request with automatic token handling
 * @param {string} userLogin - The user's login for token retrieval
 * @param {string} endpoint - The API endpoint (without base URL)
 * @param {Object} secrets - The loaded secrets object
 * @param {Object} options - Additional axios options
 * @return {Promise<Object>} The API response data
 */
async function makeTwitchApiRequest(userLogin, endpoint, secrets, options = {}) {
  const accessToken = await getValidTwitchTokenForUser(userLogin, secrets);

  const response = await axios({
    url: `${TWITCH_HELIX_BASE}${endpoint}`,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Client-Id": secrets.TWITCH_CLIENT_ID,
      ...options.headers,
    },
    ...options,
  });

  return response.data;
}

module.exports = {
  refreshTwitchToken,
  getValidTwitchTokenForUser,
  validateTwitchToken,
  makeTwitchApiRequest,
  TWITCH_TOKEN_URL,
  TWITCH_VALIDATE_URL,
  TWITCH_HELIX_BASE,
};
