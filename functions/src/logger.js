/**
 * Structured logging module using Pino
 * Configured for Google Cloud Logging compatibility
 */

const pino = require("pino");
const crypto = require("crypto");

// Detect if running in emulator
const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";

// Create base logger configuration
const pinoConfig = {
  // Use pretty logging in emulator for easier reading
  ...(!isEmulator && {
    // Production: structured JSON for Cloud Logging
    formatters: {
      level: (label, number) => {
        // Map Pino levels to Cloud Logging severity
        const severityMap = {
          10: "DEBUG",
          20: "INFO",
          30: "WARNING",
          40: "ERROR",
          50: "CRITICAL",
          60: "ALERT",
        };
        return {
          severity: severityMap[number] || "INFO",
          level: number,
        };
      },
      log: (object) => {
        // Remove Pino-specific fields that Cloud Logging doesn't need
        const {hostname, pid, ...rest} = object;
        return rest;
      },
    },
    // Use millisecond timestamps
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    // Don't include hostname and pid in production (Cloud Logging adds these)
    base: null,
  }),
  ...(isEmulator && {
    // Emulator: pretty printing for development
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss.l",
        ignore: "pid,hostname",
      },
    },
  }),
};

// Create the base logger
const logger = pino(pinoConfig);

/**
 * Creates a child logger with additional context
 * @param {Object} context - Context to add to all log messages
 * @return {Object} Child logger instance
 */
function createLogger(context = {}) {
  return logger.child(context);
}

/**
 * Middleware to add request correlation IDs
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function requestLoggingMiddleware(req, res, next) {
  // Generate or extract correlation ID
  const correlationId = req.headers["x-correlation-id"] ||
                       req.headers["x-request-id"] ||
                       crypto.randomUUID();

  // Add correlation ID to request object
  req.correlationId = correlationId;
  req.log = logger.child({
    correlationId,
    method: req.method,
    path: req.path,
  });

  // Log incoming request
  req.log.info({
    userAgent: req.headers["user-agent"],
    ip: req.ip,
  }, "Incoming request");

  // Track response time
  const start = Date.now();

  // Log response when finished
  res.on("finish", () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? "warn" : "info";

    req.log[logLevel]({
      statusCode: res.statusCode,
      duration: `${duration}ms`,
    }, "Request completed");
  });

  next();
}

/**
 * Redacts sensitive information from log data
 * @param {Object} data - Data that may contain sensitive info
 * @return {Object} Redacted data
 */
function redactSensitive(data) {
  if (!data || typeof data !== "object") {
    return data;
  }

  const redacted = {...data};
  const sensitiveKeys = [
    "password",
    "token",
    "secret",
    "key", // Matches apiKey, apikey, API_KEY, etc.
    "authorization",
  ];

  for (const key of Object.keys(redacted)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some((sk) => lowerKey.includes(sk.toLowerCase()))) {
      redacted[key] = "[REDACTED]";
    } else if (typeof redacted[key] === "object") {
      redacted[key] = redactSensitive(redacted[key]);
    }
  }

  return redacted;
}

module.exports = {
  logger,
  createLogger,
  requestLoggingMiddleware,
  redactSensitive,
};
