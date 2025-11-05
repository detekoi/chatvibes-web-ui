/**
 * Twitch API service module
 * Handles token management, validation, and API calls
 */
import { AxiosRequestConfig } from "axios";
import type { Secrets } from "../config";
declare const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
declare const TWITCH_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
declare const TWITCH_HELIX_BASE = "https://api.twitch.tv/helix";
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
declare function refreshTwitchToken(currentRefreshToken: string, secrets: Secrets): Promise<RefreshTokenResult>;
/**
 * Gets a valid Twitch access token for a user, refreshing if necessary
 * @param userLogin - The user's Twitch login
 * @param secrets - The loaded secrets object
 * @return A valid access token
 */
declare function getValidTwitchTokenForUser(userLogin: string, secrets: Secrets): Promise<string>;
/**
 * Validates a Twitch access token
 * @param accessToken - The access token to validate
 * @return The validation response data
 */
declare function validateTwitchToken(accessToken: string): Promise<TwitchValidateResponse>;
/**
 * Makes a Twitch Helix API request with automatic token handling
 * @param userLogin - The user's login for token retrieval
 * @param endpoint - The API endpoint (without base URL)
 * @param secrets - The loaded secrets object
 * @param options - Additional axios options
 * @return The API response data
 */
declare function makeTwitchApiRequest<T = unknown>(userLogin: string, endpoint: string, secrets: Secrets, options?: AxiosRequestConfig): Promise<T>;
/**
 * Gets an app access token for Twitch API calls that don't require user context
 * @param secrets - The loaded secrets object
 * @return An app access token
 */
declare function getAppAccessToken(secrets: Secrets): Promise<string>;
/**
 * Gets a Twitch user ID from a username (login)
 * @param username - The Twitch username
 * @param secrets - The loaded secrets object
 * @return The user ID or null if not found
 */
declare function getUserIdFromUsername(username: string, secrets: Secrets): Promise<string | null>;
/**
 * Adds a user as a moderator in a broadcaster's channel
 * @param broadcasterLogin - The broadcaster's Twitch login
 * @param broadcasterId - The broadcaster's Twitch user ID
 * @param moderatorUserId - The user ID to add as moderator
 * @param secrets - The loaded secrets object
 * @return Success status and optional error message. Object has success (boolean) and optional error (string) properties.
 */
declare function addModerator(broadcasterLogin: string, broadcasterId: string, moderatorUserId: string, secrets: Secrets): Promise<ModeratorResult>;
export { refreshTwitchToken, getValidTwitchTokenForUser, validateTwitchToken, makeTwitchApiRequest, getAppAccessToken, getUserIdFromUsername, addModerator, TWITCH_TOKEN_URL, TWITCH_VALIDATE_URL, TWITCH_HELIX_BASE, };
export type { TwitchTokenResponse, TwitchValidateResponse, TwitchUserData, RefreshTokenResult, ModeratorResult, };
//# sourceMappingURL=twitch.d.ts.map