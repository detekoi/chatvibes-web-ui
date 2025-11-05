"use strict";
/**
 * Test helpers for API integration tests
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEST_JWT_SECRET = void 0;
exports.createTestToken = createTestToken;
exports.createTestUser = createTestUser;
exports.getTestDb = getTestDb;
exports.clearTestData = clearTestData;
exports.setupTestEnv = setupTestEnv;
const jwt = __importStar(require("jsonwebtoken"));
const admin = __importStar(require("firebase-admin"));
// Initialize Firebase Admin for emulator
// Set emulator environment variables before initializing
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'test-project';
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: process.env.GCLOUD_PROJECT,
    });
}
// Use the same secret as the test environment
exports.TEST_JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-key-for-integration-tests';
/**
 * Create a JWT token for testing authenticated requests
 */
function createTestToken(payload) {
    // Use the JWT secret from environment or test default
    const secret = process.env.JWT_SECRET || exports.TEST_JWT_SECRET;
    return jwt.sign({
        userId: payload.userId,
        userLogin: payload.userLogin,
        displayName: payload.displayName || payload.userLogin,
        scope: payload.scope || 'viewer',
    }, secret, {
        expiresIn: '7d',
        issuer: 'chatvibes-auth',
        audience: 'chatvibes-api',
    });
}
/**
 * Create test user data
 */
function createTestUser(login = 'testuser') {
    return {
        userId: `123456789`,
        userLogin: login.toLowerCase(),
        displayName: login,
    };
}
/**
 * Get Firestore instance for testing
 */
function getTestDb() {
    return admin.firestore();
}
/**
 * Clear Firestore test data
 * Note: This requires the Firebase Emulator to be running
 */
async function clearTestData() {
    try {
        const db = getTestDb();
        const collections = ['managedChannels', 'ttsChannelConfigs', 'shortlinks', 'ttsUserPreferences'];
        for (const collectionName of collections) {
            const snapshot = await db.collection(collectionName).get();
            if (snapshot.empty)
                continue;
            const batch = db.batch();
            snapshot.docs.forEach((doc) => {
                batch.delete(doc.ref);
            });
            await batch.commit();
        }
    }
    catch (error) {
        // If Firestore emulator isn't running, skip cleanup
        // This allows tests to run without emulator (though they won't test Firestore operations)
        if (error.message?.includes('ECONNREFUSED') || error.code === 'ECONNREFUSED') {
            console.warn('Firestore emulator not running, skipping data cleanup');
            return;
        }
        throw error;
    }
}
/**
 * Set environment variables for testing
 */
function setupTestEnv() {
    process.env.FUNCTIONS_EMULATOR = 'true';
    process.env.FIREBASE_EMULATOR_HUB = 'localhost:4400';
    process.env.GCLOUD_PROJECT = 'test-project';
    process.env.JWT_SECRET = exports.TEST_JWT_SECRET;
    process.env.TWITCH_CLIENT_ID = 'test-client-id';
    process.env.TWITCH_CLIENT_SECRET = 'test-client-secret';
    process.env.FRONTEND_URL = 'http://localhost:5002';
    process.env.CALLBACK_URL = 'http://localhost:5001/test-project/us-central1/webUi/auth/twitch/callback';
    process.env.USE_ENV_SECRETS = '1';
}
//# sourceMappingURL=testHelpers.js.map