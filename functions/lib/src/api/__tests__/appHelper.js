"use strict";
/**
 * Helper to create Express app for testing
 * This extracts the Express app setup from index.js for testing purposes
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestApp = createTestApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
async function createTestApp() {
    // Setup environment FIRST before any imports
    process.env.FUNCTIONS_EMULATOR = 'true';
    process.env.USE_ENV_SECRETS = '1';
    process.env.FIREBASE_EMULATOR_HUB = 'localhost:4400';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key';
    process.env.TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || 'test-client-id';
    process.env.TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET || 'test-client-secret';
    process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5002';
    process.env.CALLBACK_URL = process.env.CALLBACK_URL || 'http://localhost:5001/test-project/us-central1/webUi/auth/twitch/callback';
    process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'test-project';
    process.env.WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY || '';
    // Clear the require cache to ensure fresh config load with new env vars
    delete require.cache[require.resolve('../../config')];
    delete require.cache[require.resolve('../../logger')];
    // Wait for secrets to load
    const { secretsLoadedPromise, config } = require('../../config');
    await secretsLoadedPromise;
    // Import middleware and routes
    const { requestLoggingMiddleware } = require('../../logger');
    const authRoutes = require('../../auth/routes');
    const authApiRoutes = require('../auth');
    const botRoutes = require('../bot');
    const rewardsRoutes = require('../rewards');
    const obsRoutes = require('../obs');
    const viewerRoutes = require('../viewer');
    const { apiRouter: miscApiRoutes, redirectRouter: redirectsRoutes } = require('../misc');
    // Create Express app
    const app = (0, express_1.default)();
    // Middleware to ensure secrets are loaded
    app.use(async (_req, res, next) => {
        try {
            await secretsLoadedPromise;
            next();
        }
        catch (error) {
            res.status(503).send('Service Unavailable: Server is initializing or has a configuration error.');
        }
    });
    // CORS Configuration
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true' || !!process.env.FIREBASE_EMULATOR_HUB;
    app.use((0, cors_1.default)({
        origin: (origin, callback) => {
            const allowed = [config.FRONTEND_URL].filter(Boolean);
            if (isEmulator) {
                allowed.push('http://127.0.0.1:5002', 'http://localhost:5002');
            }
            if (!origin || allowed.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
    }));
    // Body parsing middleware
    app.use(express_1.default.json({ limit: '1mb' }));
    app.use(express_1.default.urlencoded({ extended: true, limit: '1mb' }));
    // Request logging middleware
    app.use(requestLoggingMiddleware);
    // Mount route modules
    app.use('/auth', authRoutes);
    app.use('/api/auth', authApiRoutes);
    app.use('/api/bot', botRoutes);
    app.use('/api/rewards', rewardsRoutes);
    app.use('/api/obs', obsRoutes);
    app.use('/api/viewer', viewerRoutes);
    app.use('/api', miscApiRoutes);
    app.use('/', redirectsRoutes);
    // Health check endpoint
    app.get('/health', (_req, res) => {
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            service: 'chatvibes-web-ui-functions',
        });
    });
    // 404 handler
    app.use((req, res) => {
        res.status(404).json({
            success: false,
            error: 'Endpoint not found',
            path: req.path,
            method: req.method,
        });
    });
    // Error handler
    app.use((error, _req, res, _next) => {
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message,
        });
    });
    return app;
}
//# sourceMappingURL=appHelper.js.map