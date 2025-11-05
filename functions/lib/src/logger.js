"use strict";
/**
 * Structured logging module using Pino
 * Configured for Google Cloud Logging compatibility
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.createLogger = createLogger;
exports.requestLoggingMiddleware = requestLoggingMiddleware;
exports.redactSensitive = redactSensitive;
const pino_1 = __importDefault(require("pino"));
const crypto_1 = require("crypto");
// Detect if running in emulator
const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";
// Create base logger configuration
const pinoConfig = {
    // Use pretty logging in emulator for easier reading
    ...(!isEmulator && {
        // Production: structured JSON for Cloud Logging
        formatters: {
            level: (_label, number) => {
                // Map Pino levels to Cloud Logging severity
                const severityMap = {
                    10: "DEBUG", // trace
                    20: "DEBUG", // debug
                    30: "INFO", // info
                    40: "WARNING", // warn
                    50: "ERROR", // error
                    60: "CRITICAL", // fatal
                };
                return {
                    severity: severityMap[number] || "INFO",
                    level: number,
                };
            },
            log: (object) => {
                // Remove Pino-specific fields that Cloud Logging doesn't need
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { hostname, pid, ...rest } = object;
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
const logger = (0, pino_1.default)(pinoConfig);
exports.logger = logger;
/**
 * Creates a child logger with additional context
 * @param context - Context to add to all log messages
 * @return Child logger instance
 */
function createLogger(context = {}) {
    return logger.child(context);
}
/**
 * Middleware to add request correlation IDs
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
function requestLoggingMiddleware(req, res, next) {
    // Generate or extract correlation ID
    const correlationId = req.headers["x-correlation-id"] ||
        req.headers["x-request-id"] ||
        (0, crypto_1.randomUUID)();
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
 * @param data - Data that may contain sensitive info
 * @return Redacted data
 */
function redactSensitive(data) {
    if (!data || typeof data !== "object") {
        return data;
    }
    const redacted = { ...data };
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
        }
        else if (typeof redacted[key] === "object" && redacted[key] !== null) {
            redacted[key] = redactSensitive(redacted[key]);
        }
    }
    return redacted;
}
//# sourceMappingURL=logger.js.map