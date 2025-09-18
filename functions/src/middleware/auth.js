/**
 * Authentication middleware for API requests
 */

const jwt = require("jsonwebtoken");

/**
 * Middleware to authenticate API requests using JWT tokens
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @return {void} Calls next() or sends error response
 */
const authenticateApiRequest = (req, res, next) => {
  console.log(`--- authenticateApiRequest for ${req.path} ---`);
  const authHeader = req.headers.authorization;
  console.log("Received Authorization Header:", authHeader);

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn("API Auth Middleware: Missing or malformed Authorization header.");
    return res.status(401).json({success: false, message: "Unauthorized: Missing or malformed token."});
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    console.warn("API Auth Middleware: Token not found after Bearer prefix.");
    return res.status(401).json({success: false, message: "Unauthorized: Token not found."});
  }
  console.log("API Auth Middleware: Token extracted:", token ? "Present" : "MISSING_OR_EMPTY");

  // Get JWT secret from the secrets loaded by config
  const {secrets} = require("../config");

  if (!secrets.JWT_SECRET) {
    console.error("API Auth: JWT_SECRET is not configured. Cannot verify token.");
    return res.status(500).json({success: false, message: "Server error: Auth misconfiguration."});
  }

  try {
    const decoded = jwt.verify(token, secrets.JWT_SECRET);
    req.user = {
      userId: decoded.userId,
      userLogin: decoded.userLogin,
      displayName: decoded.displayName,
    };
    console.log(`API Auth Middleware: User ${req.user.userLogin} authenticated successfully.`);
    next();
  } catch (error) {
    console.warn(`API Auth Middleware: Token verification failed for ${req.path}:`, error.message);
    return res.status(401).json({success: false, message: "Unauthorized: Invalid or expired token."});
  }
};

module.exports = {
  authenticateApiRequest,
};
