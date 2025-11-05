"use strict";
/**
 * Refactored ChatVibes Web UI Functions
 *
 * This is the new modular entry point for the Firebase Functions.
 * The original monolithic index.js has been refactored into smaller,
 * feature-focused modules for better maintainability.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webUi = void 0;
const functions = __importStar(require("firebase-functions"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
// Import configuration and wait for secrets to load
const config_1 = require("./src/config");
const logger_1 = require("./src/logger");
// Import route modules
const routes_1 = __importDefault(require("./src/auth/routes"));
const auth_1 = __importDefault(require("./src/api/auth"));
const bot_1 = __importDefault(require("./src/api/bot"));
const rewards_1 = __importDefault(require("./src/api/rewards"));
const obs_1 = __importDefault(require("./src/api/obs"));
const viewer_1 = __importDefault(require("./src/api/viewer"));
const misc_1 = require("./src/api/misc");
// Create Express app
const app = (0, express_1.default)();
// Middleware to ensure secrets are loaded before processing any requests
app.use(async (_req, res, next) => {
    try {
        await config_1.secretsLoadedPromise;
        next();
    }
    catch (error) {
        const err = error;
        logger_1.logger.error({ error: err.message }, "Function is not ready, secrets failed to load");
        res.status(503).send("Service Unavailable: Server is initializing or has a configuration error.");
    }
});
// CORS Configuration
const isEmulator = process.env.FUNCTIONS_EMULATOR === "true" || !!process.env.FIREBASE_EMULATOR_HUB;
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        const allowed = [config_1.config.FRONTEND_URL].filter(Boolean);
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
app.use(express_1.default.json({ limit: "1mb" }));
app.use(express_1.default.urlencoded({ extended: true, limit: "1mb" }));
// Request logging middleware (adds correlation ID and logs requests/responses)
app.use(logger_1.requestLoggingMiddleware);
// Mount route modules
app.use("/auth", routes_1.default);
app.use("/api/auth", auth_1.default);
app.use("/api/bot", bot_1.default);
app.use("/api/rewards", rewards_1.default);
app.use("/api/obs", obs_1.default);
app.use("/api/viewer", viewer_1.default);
app.use("/api", misc_1.apiRouter); // For /api/shortlink, /api/tts/test
app.use("/", misc_1.redirectRouter); // For /s/:slug redirect
// Health check endpoint
app.get("/health", (_req, res) => {
    res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        service: "chatvibes-web-ui-functions",
    });
});
// 404 handler
app.use((req, res) => {
    logger_1.logger.warn({ method: req.method, path: req.path }, "404 Not Found");
    res.status(404).json({
        success: false,
        error: "Endpoint not found",
        path: req.path,
        method: req.method,
    });
});
// Error handler
app.use((error, req, res, _next) => {
    logger_1.logger.error({
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
exports.webUi = functions.https.onRequest(app);
//# sourceMappingURL=index.js.map