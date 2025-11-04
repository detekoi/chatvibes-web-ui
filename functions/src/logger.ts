/**
 * Structured logging module using Pino
 * Configured for Google Cloud Logging compatibility
 */

import pino from "pino";
import {randomUUID} from "crypto";
import type {Request, Response, NextFunction} from "express";
import type {Logger} from "pino";

// Detect if running in emulator
const isEmulator = process.env.FUNCTIONS_EMULATOR === "true";

// Define severity mapping type
type SeverityMap = {
  [key: number]: string;
};

// Define log level type
type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

// Extend Express Request to include logger and correlationId
declare global {
  namespace Express {
    interface Request {
      log: Logger;
      correlationId: string;
    }
  }
}

// Create base logger configuration
const pinoConfig: pino.LoggerOptions = {
  // Use pretty logging in emulator for easier reading
  ...(!isEmulator && {
    // Production: structured JSON for Cloud Logging
    formatters: {
      level: (_label: string, number: number) => {
        // Map Pino levels to Cloud Logging severity
        const severityMap: SeverityMap = {
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
      log: (object: Record<string, unknown>) => {
        // Remove Pino-specific fields that Cloud Logging doesn't need
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
 * @param context - Context to add to all log messages
 * @return Child logger instance
 */
function createLogger(context: Record<string, unknown> = {}): Logger {
  return logger.child(context);
}

/**
 * Middleware to add request correlation IDs
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Generate or extract correlation ID
  const correlationId = (req.headers["x-correlation-id"] as string) ||
                       (req.headers["x-request-id"] as string) ||
                       randomUUID();

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
    const logLevel: LogLevel = res.statusCode >= 400 ? "warn" : "info";

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
function redactSensitive<T>(data: T): T {
  if (!data || typeof data !== "object") {
    return data;
  }

  const redacted = {...data} as Record<string, unknown>;
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
    } else if (typeof redacted[key] === "object" && redacted[key] !== null) {
      redacted[key] = redactSensitive(redacted[key]);
    }
  }

  return redacted as T;
}

export {
  logger,
  createLogger,
  requestLoggingMiddleware,
  redactSensitive,
};
