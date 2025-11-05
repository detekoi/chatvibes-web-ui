"use strict";
/**
 * Authentication middleware for API requests
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticateApiRequest = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const logger_1 = require("../logger");
const config_1 = require("../config");
/**
 * Middleware to authenticate API requests using JWT tokens
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 * @return Calls next() or sends error response
 */
const authenticateApiRequest = (req, res, next) => {
    const log = logger_1.logger.child({ path: req.path });
    log.debug("authenticateApiRequest");
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        log.warn("Missing or malformed Authorization header");
        res.status(401).json({ success: false, message: "Unauthorized: Missing or malformed token." });
        return;
    }
    const token = authHeader.split(" ")[1];
    if (!token) {
        log.warn("Token not found after Bearer prefix");
        res.status(401).json({ success: false, message: "Unauthorized: Token not found." });
        return;
    }
    if (!config_1.secrets.JWT_SECRET) {
        log.error("JWT_SECRET is not configured. Cannot verify token.");
        res.status(500).json({ success: false, message: "Server error: Auth misconfiguration." });
        return;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, config_1.secrets.JWT_SECRET);
        // Preserve primary fields and important claims for viewer flows
        req.user = {
            userId: decoded.userId,
            userLogin: decoded.userLogin,
            displayName: decoded.displayName,
            scope: decoded.scope,
            tokenUser: decoded.tokenUser,
        };
        log.info({ userLogin: req.user.userLogin }, "User authenticated successfully");
        next();
    }
    catch (error) {
        const err = error;
        log.warn({ error: err.message }, "Token verification failed");
        res.status(401).json({ success: false, message: "Unauthorized: Invalid or expired token." });
    }
};
exports.authenticateApiRequest = authenticateApiRequest;
//# sourceMappingURL=auth.js.map