/**
 * Twitch API service module
 * Handles token management, validation, and API calls
 */

import axios, {AxiosRequestConfig} from "axios";
import {db, COLLECTIONS} from "./firestore";
import {secretManagerClient, config} from "../config";
import {logger, redactSensitive} from "../logger";
import type {Secrets} from "../config";

// Twitch API endpoints
const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
const TWITCH_HELIX_BASE = "https://api.twitch.tv/helix";

// Type definitions for Twitch API responses
interface TwitchTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string[];
  token_type?: string;
}

interface TwitchValidateResponse {
  client_id: string;
  login: string;
  scopes: string[];
  user_id: string;
  expires_in: number;
}

interface TwitchUserData {
  twitchUserId?: string;
  twitchAccessTokenExpiresAt?: FirebaseFirestore.Timestamp;
  needsTwitchReAuth?: boolean;
}

interface RefreshTokenResult {
  newAccessToken: string;
  newRefreshToken: string;
  expiresAt: Date;
}

interface ModeratorResult {
  success: boolean;
  error?: string;
}

/**
 * Refreshes a Twitch access token using the refresh token
 * @param currentRefreshToken - The current refresh token
 * @param secrets - The loaded secrets object
 * @return The new tokens and expiration
 */
async function refreshTwitchToken(currentRefreshToken: string, secrets: Secrets): Promise<RefreshTokenResult> {
  if (!secrets.TWITCH_CLIENT_ID || !secrets.TWITCH_CLIENT_SECRET) {
    logger.error("Twitch client ID or secret not configured for token refresh.");
    throw new Error("Server configuration error for Twitch token refresh.");
  }

  logger.info("Attempting to refresh Twitch token...");

  try {
    const refreshResponse = await axios.post<TwitchTokenResponse>(TWITCH_TOKEN_URL, null, {
      params: {
        client_id: secrets.TWITCH_CLIENT_ID,
        client_secret: secrets.TWITCH_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: currentRefreshToken,
      },
    });

    const {access_token: newAccessToken, refresh_token: newRefreshToken, expires_in: expiresIn} = refreshResponse.data;

    if (!newAccessToken || !newRefreshToken) {
      logger.error({responseData: redactSensitive(refreshResponse.data)}, "Missing access_token or refresh_token in refresh response");
      throw new Error("Twitch did not return the expected refreshed tokens.");
    }

    const expiresAt = new Date(Date.now() + (expiresIn * 1000));
    logger.info({expiresAt: expiresAt.toISOString()}, "Successfully refreshed Twitch token");

    return {
      newAccessToken,
      newRefreshToken,
      expiresAt,
    };
  } catch (error) {
    const err = error as {message: string; response?: {data: unknown}};
    logger.error({
      error: err.message,
      responseData: redactSensitive(err.response?.data),
    }, "Failed to refresh Twitch token");
    throw new Error("Failed to refresh Twitch token");
  }
}

/**
 * Gets a valid Twitch access token for a user, refreshing if necessary
 * @param userLogin - The user's Twitch login
 * @param secrets - The loaded secrets object
 * @return A valid access token
 */
async function getValidTwitchTokenForUser(userLogin: string, secrets: Secrets): Promise<string> {
  const log = logger.child({userLogin});

  if (!db || !secretManagerClient) {
    log.error("Firestore or Secret Manager client not initialized!");
    throw new Error("Server configuration error.");
  }

  const userDocRef = db.collection(COLLECTIONS.MANAGED_CHANNELS).doc(userLogin);
  const userDoc = await userDocRef.get();

  if (!userDoc.exists) {
    log.error("User not found in managed channels");
    throw new Error("User not found in managed channels.");
  }

  const userData = userDoc.data() as TwitchUserData;
  const {twitchUserId, twitchAccessTokenExpiresAt, needsTwitchReAuth} = userData;

  if (needsTwitchReAuth) {
    log.error("User needs to re-authenticate with Twitch");
    throw new Error("User needs to re-authenticate with Twitch.");
  }

  if (!twitchUserId) {
    log.error("User missing twitchUserId");
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
      const data = version.payload?.data;
      if (!data) {
        throw new Error("Secret has no data");
      }
      const accessToken = data.toString().trim();
      log.info("Using existing valid token");
      return accessToken;
    } catch (error) {
      const err = error as Error;
      log.warn({error: err.message}, "Failed to get access token from Secret Manager");
      // Continue to refresh flow
    }
  }

  // Token is expired or missing, refresh it
  log.info("Token expired or missing, refreshing...");

  try {
    // Get refresh token from Secret Manager
    const refreshSecretName = `projects/${config.GCLOUD_PROJECT}/secrets/twitch-refresh-token-${twitchUserId}`;
    const [refreshVersion] = await secretManagerClient.accessSecretVersion({
      name: `${refreshSecretName}/versions/latest`,
    });
    const refreshData = refreshVersion.payload?.data;
    if (!refreshData) {
      throw new Error("Refresh secret has no data");
    }
    const refreshToken = refreshData.toString().trim();

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

    log.info("Successfully refreshed token");
    return newAccessToken;
  } catch (error) {
    const err = error as Error;
    log.error({error: err.message}, "Failed to refresh token");

    // Mark user as needing re-auth
    await userDocRef.update({
      needsTwitchReAuth: true,
      lastTokenError: err.message,
      lastTokenErrorAt: new Date(),
    });

    throw new Error("Token refresh failed, user needs to re-authenticate");
  }
}

/**
 * Validates a Twitch access token
 * @param accessToken - The access token to validate
 * @return The validation response data
 */
async function validateTwitchToken(accessToken: string): Promise<TwitchValidateResponse> {
  try {
    const response = await axios.get<TwitchValidateResponse>(TWITCH_VALIDATE_URL, {
      headers: {Authorization: `OAuth ${accessToken}`},
    });
    return response.data;
  } catch (error) {
    const err = error as {message: string; response?: {data: unknown}};
    logger.error({
      error: err.message,
      responseData: redactSensitive(err.response?.data),
    }, "Failed to validate Twitch token");
    throw new Error("Token validation failed");
  }
}

/**
 * Makes a Twitch Helix API request with automatic token handling
 * @param userLogin - The user's login for token retrieval
 * @param endpoint - The API endpoint (without base URL)
 * @param secrets - The loaded secrets object
 * @param options - Additional axios options
 * @return The API response data
 */
async function makeTwitchApiRequest<T = unknown>(
  userLogin: string,
  endpoint: string,
  secrets: Secrets,
  options: AxiosRequestConfig = {},
): Promise<T> {
  const accessToken = await getValidTwitchTokenForUser(userLogin, secrets);

  const response = await axios<T>({
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

/**
 * Gets an app access token for Twitch API calls that don't require user context
 * @param secrets - The loaded secrets object
 * @return An app access token
 */
async function getAppAccessToken(secrets: Secrets): Promise<string> {
  try {
    const response = await axios.post<TwitchTokenResponse>(TWITCH_TOKEN_URL, null, {
      params: {
        client_id: secrets.TWITCH_CLIENT_ID,
        client_secret: secrets.TWITCH_CLIENT_SECRET,
        grant_type: "client_credentials",
      },
      timeout: 15000,
    });

    if (!response.data?.access_token) {
      throw new Error("No access token in response");
    }

    return response.data.access_token;
  } catch (error) {
    const err = error as {message: string; response?: {data: unknown}};
    logger.error({
      error: err.message,
      responseData: redactSensitive(err.response?.data),
    }, "[getAppAccessToken] Error getting app access token");
    throw new Error("Failed to get app access token");
  }
}

/**
 * Gets a Twitch user ID from a username (login)
 * @param username - The Twitch username
 * @param secrets - The loaded secrets object
 * @return The user ID or null if not found
 */
async function getUserIdFromUsername(username: string, secrets: Secrets): Promise<string | null> {
  try {
    // Use app access token for this lookup (doesn't require user context)
    const appToken = await getAppAccessToken(secrets);

    interface TwitchUsersResponse {
      data: Array<{id: string; login: string; display_name: string}>;
    }

    const response = await axios.get<TwitchUsersResponse>(`${TWITCH_HELIX_BASE}/users`, {
      params: {login: username.toLowerCase()},
      headers: {
        "Authorization": `Bearer ${appToken}`,
        "Client-Id": secrets.TWITCH_CLIENT_ID,
      },
      timeout: 15000,
    });

    if (response.data?.data && response.data.data.length > 0) {
      return response.data.data[0].id;
    }
    return null;
  } catch (error) {
    const err = error as {message: string; response?: {data: unknown}};
    logger.error({
      username,
      error: err.message,
      responseData: redactSensitive(err.response?.data),
    }, "[getUserIdFromUsername] Error getting user ID");
    return null;
  }
}

/**
 * Adds a user as a moderator in a broadcaster's channel
 * @param broadcasterLogin - The broadcaster's Twitch login
 * @param broadcasterId - The broadcaster's Twitch user ID
 * @param moderatorUserId - The user ID to add as moderator
 * @param secrets - The loaded secrets object
 * @return Success status and optional error message. Object has success (boolean) and optional error (string) properties.
 */
async function addModerator(
  broadcasterLogin: string,
  broadcasterId: string,
  moderatorUserId: string,
  secrets: Secrets,
): Promise<ModeratorResult> {
  try {
    const accessToken = await getValidTwitchTokenForUser(broadcasterLogin, secrets);

    const response = await axios.post(
        `${TWITCH_HELIX_BASE}/moderation/moderators`,
        null,
        {
          params: {
            broadcaster_id: broadcasterId,
            user_id: moderatorUserId,
          },
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Client-Id": secrets.TWITCH_CLIENT_ID,
          },
          timeout: 15000,
        },
    );

    // 204 No Content means success (moderator was added)
    if (response.status === 204) {
      logger.info({broadcasterLogin, moderatorUserId}, "[addModerator] Successfully added moderator");
      return {success: true};
    }

    return {success: false, error: `Unexpected status: ${response.status}`};
  } catch (error) {
    const err = error as {message: string; response?: {status: number; data: {message?: string}}};
    const status = err.response?.status;
    const errorData = err.response?.data;
    const errorMessage = errorData?.message || err.message;
    const log = logger.child({broadcasterLogin, moderatorUserId, status});

    // 401 Unauthorized - token invalid, expired, or missing scope
    if (status === 401) {
      log.warn("Authentication failed - may be missing channel:manage:moderators scope");
      return {success: false, error: "Authentication failed. Missing required scope or invalid token. Please re-authenticate."};
    }

    // 403 Forbidden - user is already a moderator or other permission issue
    if (status === 403) {
      log.info("User is already a moderator (403 response)");
      return {success: true}; // Already a mod, treat as success
    }

    // 400 Bad Request - could be: invalid parameters, user banned, or VIP
    if (status === 400) {
      log.warn({errorMessage}, "Cannot add user as moderator");
      return {success: false, error: errorMessage || "User cannot be added as moderator (may be banned, VIP, or invalid parameters)"};
    }

    // Other errors
    log.error({
      errorMessage,
      errorData: redactSensitive(errorData),
    }, "Error adding moderator");
    return {success: false, error: errorMessage || "Unknown error occurred"};
  }
}

export {
  refreshTwitchToken,
  getValidTwitchTokenForUser,
  validateTwitchToken,
  makeTwitchApiRequest,
  getAppAccessToken,
  getUserIdFromUsername,
  addModerator,
  TWITCH_TOKEN_URL,
  TWITCH_VALIDATE_URL,
  TWITCH_HELIX_BASE,
};

export type {
  TwitchTokenResponse,
  TwitchValidateResponse,
  TwitchUserData,
  RefreshTokenResult,
  ModeratorResult,
};
