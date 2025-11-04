/**
 * Authentication middleware for API requests
 */

import jwt from "jsonwebtoken";
import {logger} from "../logger";
import {secrets} from "../config";
import type {Request, Response, NextFunction} from "express";

// Define the JWT payload structure
interface JwtPayload {
  userId: string;
  userLogin: string;
  displayName: string;
  scope?: string;
  tokenUser?: string;
}

// Define authenticated user structure
interface AuthenticatedUser {
  userId: string;
  userLogin: string;
  displayName: string;
  scope?: string;
  tokenUser?: string;
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
 * Middleware to authenticate API requests using JWT tokens
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 * @return Calls next() or sends error response
 */
const authenticateApiRequest = (req: Request, res: Response, next: NextFunction): void => {
  const log = logger.child({path: req.path});
  log.debug("authenticateApiRequest");

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    log.warn("Missing or malformed Authorization header");
    res.status(401).json({success: false, message: "Unauthorized: Missing or malformed token."});
    return;
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    log.warn("Token not found after Bearer prefix");
    res.status(401).json({success: false, message: "Unauthorized: Token not found."});
    return;
  }

  if (!secrets.JWT_SECRET) {
    log.error("JWT_SECRET is not configured. Cannot verify token.");
    res.status(500).json({success: false, message: "Server error: Auth misconfiguration."});
    return;
  }

  try {
    const decoded = jwt.verify(token, secrets.JWT_SECRET) as JwtPayload;
    // Preserve primary fields and important claims for viewer flows
    req.user = {
      userId: decoded.userId,
      userLogin: decoded.userLogin,
      displayName: decoded.displayName,
      scope: decoded.scope,
      tokenUser: decoded.tokenUser,
    };
    log.info({userLogin: req.user.userLogin}, "User authenticated successfully");
    next();
  } catch (error) {
    const err = error as Error;
    log.warn({error: err.message}, "Token verification failed");
    res.status(401).json({success: false, message: "Unauthorized: Invalid or expired token."});
  }
};

export {
  authenticateApiRequest,
};

export type {
  JwtPayload,
  AuthenticatedUser,
};
