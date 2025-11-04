/**
 * Refactored ChatVibes Web UI Functions
 *
 * This is the new modular entry point for the Firebase Functions.
 * The original monolithic index.js has been refactored into smaller,
 * feature-focused modules for better maintainability.
 */

import * as functions from "firebase-functions";
import express, {Request, Response, NextFunction, Application} from "express";
import cors from "cors";

// Import configuration and wait for secrets to load
import {secretsLoadedPromise, config} from "./src/config";
import {logger, requestLoggingMiddleware} from "./src/logger";

// Import route modules
import authRoutes from "./src/auth/routes";
import authApiRoutes from "./src/api/auth";
import botRoutes from "./src/api/bot";
import rewardsRoutes from "./src/api/rewards";
import obsRoutes from "./src/api/obs";
import viewerRoutes from "./src/api/viewer";
import {apiRouter as miscApiRoutes, redirectRouter as redirectsRoutes} from "./src/api/misc";

// Create Express app
const app: Application = express();

// Middleware to ensure secrets are loaded before processing any requests
app.use(async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await secretsLoadedPromise;
    next();
  } catch (error) {
    const err = error as Error;
    logger.error({error: err.message}, "Function is not ready, secrets failed to load");
    res.status(503).send("Service Unavailable: Server is initializing or has a configuration error.");
  }
});

// CORS Configuration
const isEmulator = process.env.FUNCTIONS_EMULATOR === "true" || !!process.env.FIREBASE_EMULATOR_HUB;
app.use(cors({
  origin: (origin, callback) => {
    const allowed = [config.FRONTEND_URL].filter(Boolean);
    if (isEmulator) {
      allowed.push("http://127.0.0.1:5002", "http://localhost:5002");
    }
    if (!origin || allowed.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));

// Body parsing middleware
app.use(express.json({limit: "1mb"}));
app.use(express.urlencoded({extended: true, limit: "1mb"}));

// Request logging middleware (adds correlation ID and logs requests/responses)
app.use(requestLoggingMiddleware);

// Mount route modules
app.use("/auth", authRoutes);
app.use("/api/auth", authApiRoutes);
app.use("/api/bot", botRoutes);
app.use("/api/rewards", rewardsRoutes);
app.use("/api/obs", obsRoutes);
app.use("/api/viewer", viewerRoutes);
app.use("/api", miscApiRoutes); // For /api/shortlink, /api/tts/test
app.use("/", redirectsRoutes); // For /s/:slug redirect

// Health check endpoint
app.get("/health", (_req: Request, res: Response): void => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "chatvibes-web-ui-functions",
  });
});

// 404 handler
app.use((req: Request, res: Response): void => {
  logger.warn({method: req.method, path: req.path}, "404 Not Found");
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    path: req.path,
    method: req.method,
  });
});

// Error handler
app.use((error: Error, req: Request, res: Response, _next: NextFunction): void => {
  logger.error({
    error: error.message,
    stack: error.stack,
    method: req.method,
    path: req.path,
  }, "Unhandled error");
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: error.message,
  });
});

// Export the Express app as a Firebase Cloud Function
export const webUi = functions.https.onRequest(app);
