/**
 * Authentication middleware for API requests
 */

const jwt = require("jsonwebtoken");
const {logger, redactSensitive} = require("../logger");

/**
 * Middleware to authenticate API requests using JWT tokens
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @return {void} Calls next() or sends error response
 */
const authenticateApiRequest = (req, res, next) => {
  const log = logger.child({path: req.path});
  log.debug("authenticateApiRequest");
  
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    log.warn("Missing or malformed Authorization header");
    return res.status(401).json({success: false, message: "Unauthorized: Missing or malformed token."});
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    log.warn("Token not found after Bearer prefix");
    return res.status(401).json({success: false, message: "Unauthorized: Token not found."});
  }

  // Get JWT secret from the secrets loaded by config
  const {secrets} = require("../config");

  if (!secrets.JWT_SECRET) {
    log.error("JWT_SECRET is not configured. Cannot verify token.");
    return res.status(500).json({success: false, message: "Server error: Auth misconfiguration."});
  }

  try {
    const decoded = jwt.verify(token, secrets.JWT_SECRET);
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
    log.warn({error: error.message}, "Token verification failed");
    return res.status(401).json({success: false, message: "Unauthorized: Invalid or expired token."});
  }
};

module.exports = {
  authenticateApiRequest,
};
