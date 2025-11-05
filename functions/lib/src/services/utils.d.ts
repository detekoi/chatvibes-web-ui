/**
 * Utility functions used across the application
 */
/**
 * Gets the current Google Cloud project ID
 * @return The project ID
 */
declare function getProjectId(): string;
/**
 * Normalizes a secret version path
 * @param secretInput - The secret input to normalize
 * @return The normalized secret path
 */
declare function normalizeSecretVersionPath(secretInput: string): string;
/**
 * Gets the list of allowed channels from environment or secret
 * @return Array of allowed channels or null if no restrictions
 */
declare function getAllowedChannelsList(): Promise<string[] | null>;
/**
 * Validates TTS speed parameter
 * @param speed - The speed value to validate
 * @return True if valid
 */
declare function validateSpeed(speed: number): boolean;
/**
 * Validates TTS pitch parameter
 * @param pitch - The pitch value to validate
 * @return True if valid
 */
declare function validatePitch(pitch: number): boolean;
/**
 * Normalizes common emotion synonyms to canonical tokens
 * @param emotion - Raw emotion value (may be capitalized or a synonym)
 * @return Canonical token or null
 */
declare function normalizeEmotion(emotion: string | null | undefined): string | null;
/**
 * Validates TTS emotion parameter
 * @param emotion - The emotion value to validate (canonical or synonym)
 * @return True if valid
 */
declare function validateEmotion(emotion: string | null): boolean;
/**
 * Validates language boost parameter
 * @param languageBoost - The language boost value to validate
 * @return True if valid
 */
declare function validateLanguageBoost(languageBoost: string): boolean;
/**
 * Creates a short link and stores it in Firestore
 * @param longUrl - The URL to shorten
 * @return The generated slug
 */
declare function createShortLink(longUrl: string): Promise<string>;
export { getProjectId, normalizeSecretVersionPath, getAllowedChannelsList, validateSpeed, validatePitch, normalizeEmotion, validateEmotion, validateLanguageBoost, createShortLink, };
//# sourceMappingURL=utils.d.ts.map