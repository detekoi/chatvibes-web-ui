/**
 * Rate limiting middleware
 * Protects API endpoints from abuse
 */

import rateLimit from "express-rate-limit";

/**
 * Rate limiter for authentication routes (/auth/*)
 * Stricter limit to prevent brute-force attacks
 */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: "Too many authentication attempts, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
});

/**
 * Rate limiter for general API routes (/api/*)
 */
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: "Too many requests, please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
});
