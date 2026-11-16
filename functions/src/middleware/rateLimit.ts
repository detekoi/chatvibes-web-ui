/**
 * Rate limiting middleware
 * Protects API endpoints from abuse
 */

import rateLimit, { type Options } from "express-rate-limit";
import type { Request } from "express";
import { verifySessionToken } from "./auth";

// Default IP-based key generator that handles IPv6 normalization correctly.
// Used as fallback when no authenticated user ID is available.
const defaultIpKey: Options["keyGenerator"] = (req, _res) => req.ip ?? "unknown";

/**
 * Rate limiter for authentication routes (/auth/*)
 * Stricter limit to prevent brute-force attacks
 */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    // Keyed by IP, and these routes carry no credential to brute-force — they
    // build a Twitch redirect and exchange a single-use code. The old limit of
    // 20 locked out everyone sharing a NAT (offices, dorms, carrier CGNAT).
    max: 60,
    message: "Too many authentication attempts, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
});

/** Requests in 15 minutes for one signed-in user. */
export const API_LIMIT_PER_USER = 300;
/** Requests in 15 minutes for one address that sends no valid session token. */
export const API_LIMIT_PER_IP = 100;

/**
 * The user ID in a valid session token, else null. The token is verified, not
 * only decoded: an unverified ID would let a client pick a new bucket for every
 * request.
 */
function sessionUserId(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return null;
    const token = header.slice("Bearer ".length);
    if (!token) return null;
    try {
        return verifySessionToken(token).userId || null;
    } catch {
        return null;
    }
}

/**
 * Rate limiter for general API routes (/api/*). Mount it once for the whole
 * /api tree: each mount that a request passes through counts it again.
 *
 * A signed-in user has a bucket of their own. On 2026-11-16 one viewer who tried
 * voices (34 previews, 37 automatic saves) used up the old limit of 100 per IP in
 * about 10 minutes. After that, every call failed with 429, the sign-in check
 * among them, so the page asked them to sign in again and showed no settings.
 * The busiest real user in the week before needed 67 in 15 minutes, so 300
 * leaves room for a long session. The cost of previews is capped separately by
 * ttsTestLimiter.
 */
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: (req) => (sessionUserId(req) ? API_LIMIT_PER_USER : API_LIMIT_PER_IP),
    message: "Too many requests, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, res) => {
        const userId = sessionUserId(req);
        return userId ? `user:${userId}` : `ip:${defaultIpKey(req, res)}`;
    },
});

/**
 * Rate limiter for the TTS test endpoint — keyed by authenticated user ID
 * to avoid all users sharing a single IP bucket behind Firebase's proxy.
 */
export const ttsTestLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30,
    message: "Too many TTS test requests, please wait a moment.",
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, res) => {
        const userId = (req as any).user?.userId;
        if (userId) return userId;
        return defaultIpKey(req, res);
    },
});
