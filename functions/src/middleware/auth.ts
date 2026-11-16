/**
 * Authentication middleware for API requests
 */

import jwt from "jsonwebtoken";
import { logger } from "../logger";
import { secrets } from "../config";
import type { Request, Response, NextFunction } from "express";

// Define the JWT payload structure
interface JwtPayload {
  userId: string;
  userLogin: string;
  displayName: string;
  scope?: string;
}

// Define authenticated user structure
interface AuthenticatedUser {
  userId: string;
  userLogin: string;
  displayName: string;
  scope?: string;
}

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * The token in an `Authorization: Bearer <token>` header, else null. The rate
 * limiter and authenticateApiRequest both read the token here: if they parsed
 * the header differently, a header that one rejects and the other accepts would
 * move a signed-in user out of their own rate limit bucket.
 */
export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length) || null;
}

/**
 * The session token in a request, verified. Throws when it is not valid.
 * @param token - The token after "Bearer ".
 */
export function verifySessionToken(token: string): AuthenticatedUser {
  if (!secrets.JWT_SECRET) throw new Error("JWT_SECRET is not configured");
  const decoded = jwt.verify(token, secrets.JWT_SECRET, {
    audience: ["wildcat-tts-api", "chatvibes-api"],
    issuer: ["wildcat-tts-auth", "chatvibes-auth"],
  }) as JwtPayload;
  return {
    userId: decoded.userId,
    userLogin: decoded.userLogin,
    displayName: decoded.displayName,
    scope: decoded.scope,
  };
}

/**
 * Middleware to authenticate API requests using JWT tokens
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 * @return Calls next() or sends error response
 */
const authenticateApiRequest = (req: Request, res: Response, next: NextFunction): void => {
  const log = logger.child({ path: req.path });
  log.debug("authenticateApiRequest");

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    log.warn("Missing or malformed Authorization header");
    res.status(401).json({ success: false, message: "Unauthorized: Missing or malformed token." });
    return;
  }

  const token = bearerToken(req);
  if (!token) {
    log.warn("Token not found after Bearer prefix");
    res.status(401).json({ success: false, message: "Unauthorized: Token not found." });
    return;
  }

  if (!secrets.JWT_SECRET) {
    log.error("JWT_SECRET is not configured. Cannot verify token.");
    res.status(500).json({ success: false, message: "Server error: Auth misconfiguration." });
    return;
  }

  try {
    req.user = verifySessionToken(token);
    log.info({ userLogin: req.user.userLogin }, "User authenticated successfully");
    next();
  } catch (error) {
    const err = error as Error;
    log.warn({ error: err.message }, "Token verification failed");
    res.status(401).json({ success: false, message: "Unauthorized: Invalid or expired token." });
  }
};

export function assertAuthenticated(req: Request): asserts req is Request & { user: AuthenticatedUser } {
  if (!req.user) {
    throw new Error("Unauthenticated - should never reach here post-middleware");
  }
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}

/**
 * Middleware to verify the authenticated user owns the :channelName param.
 * Must be placed after authenticateApiRequest in the middleware chain.
 */
const authorizeChannelAccess = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ success: false, message: "Unauthorized: Token not found." });
    return;
  }
  const channelName = req.params.channelName;
  if (!channelName || req.user.userLogin.toLowerCase() !== channelName.toLowerCase()) {
    res.status(403).json({ error: "Unauthorized access to channel settings" });
    return;
  }
  next();
};

export {
  authenticateApiRequest,
  authorizeChannelAccess,
};

export type {
  JwtPayload,
  AuthenticatedUser,
};

