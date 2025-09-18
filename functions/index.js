/**
 * Refactored ChatVibes Web UI Functions
 *
 * This is the new modular entry point for the Firebase Functions.
 * The original monolithic index.js has been refactored into smaller,
 * feature-focused modules for better maintainability.
 */

const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");

// Import configuration and wait for secrets to load
const {secretsLoadedPromise, config} = require("./src/config");

// Import route modules
const authRoutes = require("./src/auth/routes");
const botRoutes = require("./src/api/bot");
const rewardsRoutes = require("./src/api/rewards");
const obsRoutes = require("./src/api/obs");
const viewerRoutes = require("./src/api/viewer");
const miscRoutes = require("./src/api/misc");

// Create Express app
const app = express();

// Middleware to ensure secrets are loaded before processing any requests
app.use(async (req, res, next) => {
  try {
    await secretsLoadedPromise;
    next();
  } catch (error) {
    console.error("Function is not ready, secrets failed to load.", error.message);
    res.status(503).send("Service Unavailable: Server is initializing or has a configuration error.");
  }
});

// CORS Configuration
app.use(cors({
  origin: [
    "http://127.0.0.1:5002",
    "http://localhost:5002",
    config.FRONTEND_URL,
  ].filter(Boolean), // Remove any undefined values
  credentials: true,
}));

// Body parsing middleware
app.use(express.json({limit: "1mb"}));
app.use(express.urlencoded({extended: true, limit: "1mb"}));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

// Mount route modules
app.use("/auth", authRoutes);
app.use("/api/bot", botRoutes);
app.use("/api/rewards", rewardsRoutes);
app.use("/api/obs", obsRoutes);
app.use("/api/viewer", viewerRoutes);
app.use("/api", miscRoutes); // For /api/shortlink, /api/tts/test
app.use("/", miscRoutes); // For /s/:slug redirect

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "chatvibes-web-ui-functions",
  });
});

// 404 handler
app.use((req, res) => {
  console.warn(`404 Not Found: ${req.method} ${req.path}`);
  res.status(404).json({
    success: false,
    error: "Endpoint not found",
    path: req.path,
    method: req.method,
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error(`Unhandled error in ${req.method} ${req.path}:`, error);
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: error.message,
  });
});

// Export the Express app as a Firebase Cloud Function
exports.webUi = functions.https.onRequest(app);
