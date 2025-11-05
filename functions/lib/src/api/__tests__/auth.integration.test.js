"use strict";
/**
 * Integration tests for auth API endpoints
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
const globals_1 = require("@jest/globals");
const supertest_1 = __importDefault(require("supertest"));
const appHelper_1 = require("./appHelper");
const testHelpers_1 = require("./testHelpers");
const admin = __importStar(require("firebase-admin"));
(0, globals_1.describe)('Auth API Integration Tests', () => {
    let app;
    let db;
    const testUser = (0, testHelpers_1.createTestUser)('teststreamer');
    (0, globals_1.beforeAll)(async () => {
        app = await (0, appHelper_1.createTestApp)();
        db = (0, testHelpers_1.getTestDb)();
    });
    (0, globals_1.beforeEach)(async () => {
        await (0, testHelpers_1.clearTestData)();
    });
    (0, globals_1.describe)('GET /api/auth/status', () => {
        (0, globals_1.it)('should return 401 without token', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/auth/status')
                .expect(401);
            (0, globals_1.expect)(response.body.success).toBe(false);
            (0, globals_1.expect)(response.body.message).toContain('Unauthorized');
        });
        (0, globals_1.it)('should return 401 with invalid token', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/auth/status')
                .set('Authorization', 'Bearer invalid-token')
                .expect(401);
            (0, globals_1.expect)(response.body.success).toBe(false);
        });
        (0, globals_1.it)('should return user status for valid token when user exists', async () => {
            // Create user in Firestore
            await db.collection('managedChannels').doc(testUser.userLogin).set({
                twitchUserId: testUser.userId,
                twitchUserLogin: testUser.userLogin,
                isActive: true,
                needsTwitchReAuth: false,
            });
            const token = (0, testHelpers_1.createTestToken)(testUser);
            const response = await (0, supertest_1.default)(app)
                .get('/api/auth/status')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);
            (0, globals_1.expect)(response.body.success).toBe(true);
            (0, globals_1.expect)(response.body.user.userLogin).toBe(testUser.userLogin);
            (0, globals_1.expect)(response.body.twitchTokenStatus).toBeDefined();
        });
        (0, globals_1.it)('should return not_found status when user does not exist', async () => {
            const token = (0, testHelpers_1.createTestToken)(testUser);
            const response = await (0, supertest_1.default)(app)
                .get('/api/auth/status')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);
            (0, globals_1.expect)(response.body.success).toBe(true);
            (0, globals_1.expect)(response.body.twitchTokenStatus).toBe('not_found');
            (0, globals_1.expect)(response.body.needsTwitchReAuth).toBe(true);
        });
        (0, globals_1.it)('should return expired status when token is expired', async () => {
            await db.collection('managedChannels').doc(testUser.userLogin).set({
                twitchUserId: testUser.userId,
                twitchUserLogin: testUser.userLogin,
                isActive: true,
                needsTwitchReAuth: false,
                twitchAccessTokenExpiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 1000)), // Expired
            });
            const token = (0, testHelpers_1.createTestToken)(testUser);
            const response = await (0, supertest_1.default)(app)
                .get('/api/auth/status')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);
            (0, globals_1.expect)(response.body.success).toBe(true);
            (0, globals_1.expect)(response.body.twitchTokenStatus).toBe('expired');
        });
    });
    (0, globals_1.describe)('POST /api/auth/refresh', () => {
        (0, globals_1.it)('should return 401 without token', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/auth/refresh')
                .expect(401);
            (0, globals_1.expect)(response.body.success).toBe(false);
        });
        // Note: Testing actual token refresh would require mocking Twitch API calls
        // This is tested in unit tests for the twitch service
        (0, globals_1.it)('should return 401 with invalid token', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/auth/refresh')
                .set('Authorization', 'Bearer invalid-token')
                .expect(401);
            (0, globals_1.expect)(response.body.success).toBe(false);
        });
    });
});
//# sourceMappingURL=auth.integration.test.js.map