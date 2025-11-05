/**
 * Structured logging module using Pino
 * Configured for Google Cloud Logging compatibility
 */
import pino from "pino";
import type { Request, Response, NextFunction } from "express";
import type { Logger } from "pino";
declare global {
    namespace Express {
        interface Request {
            log: Logger;
            correlationId: string;
        }
    }
}
declare const logger: pino.Logger<never, boolean>;
/**
 * Creates a child logger with additional context
 * @param context - Context to add to all log messages
 * @return Child logger instance
 */
declare function createLogger(context?: Record<string, unknown>): Logger;
/**
 * Middleware to add request correlation IDs
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
declare function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void;
/**
 * Redacts sensitive information from log data
 * @param data - Data that may contain sensitive info
 * @return Redacted data
 */
declare function redactSensitive<T>(data: T): T;
export { logger, createLogger, requestLoggingMiddleware, redactSensitive, };
//# sourceMappingURL=logger.d.ts.map