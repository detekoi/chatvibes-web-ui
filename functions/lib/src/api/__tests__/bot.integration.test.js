"use strict";
/**
 * Integration tests for bot API endpoints
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const supertest_1 = __importDefault(require("supertest"));
const appHelper_1 = require("./appHelper");
const testHelpers_1 = require("./testHelpers");
(0, globals_1.describe)('Bot API Integration Tests', () => {
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
    (0, globals_1.describe)('GET /api/bot/status', () => {
        (0, globals_1.it)('should return 401 without token', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/api/bot/status')
                .expect(401);
            (0, globals_1.expect)(response.body.success).toBe(false);
        });
        (0, globals_1.it)('should return inactive status when bot is not active', async () => {
            const token = (0, testHelpers_1.createTestToken)(testUser);
            const response = await (0, supertest_1.default)(app)
                .get('/api/bot/status')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);
            (0, globals_1.expect)(response.body.success).toBe(true);
            (0, globals_1.expect)(response.body.isActive).toBe(false);
        });
        (0, globals_1.it)('should return active status when bot is active', async () => {
            await db.collection('managedChannels').doc(testUser.userLogin).set({
                twitchUserId: testUser.userId,
                twitchUserLogin: testUser.userLogin,
                isActive: true,
                channelName: testUser.userLogin,
            });
            const token = (0, testHelpers_1.createTestToken)(testUser);
            const response = await (0, supertest_1.default)(app)
                .get('/api/bot/status')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);
            (0, globals_1.expect)(response.body.success).toBe(true);
            (0, globals_1.expect)(response.body.isActive).toBe(true);
            (0, globals_1.expect)(response.body.channelName).toBe(testUser.userLogin);
        });
    });
    (0, globals_1.describe)('POST /api/bot/add', () => {
        (0, globals_1.it)('should return 401 without token', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/bot/add')
                .expect(401);
            (0, globals_1.expect)(response.body.success).toBe(false);
        });
        // Note: Full testing of /api/bot/add requires:
        // - Mocking Twitch API calls (getValidTwitchTokenForUser, getUserIdFromUsername, addModerator)
        // - Mocking getAllowedChannelsList
        // These are tested in unit tests for the twitch service
        (0, globals_1.it)('should return 401 with invalid token', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/bot/add')
                .set('Authorization', 'Bearer invalid-token')
                .expect(401);
            (0, globals_1.expect)(response.body.success).toBe(false);
        });
    });
    (0, globals_1.describe)('POST /api/bot/remove', () => {
        (0, globals_1.it)('should return 401 without token', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/bot/remove')
                .expect(401);
            (0, globals_1.expect)(response.body.success).toBe(false);
        });
        (0, globals_1.it)('should remove bot when user exists', async () => {
            await db.collection('managedChannels').doc(testUser.userLogin).set({
                twitchUserId: testUser.userId,
                twitchUserLogin: testUser.userLogin,
                isActive: true,
                channelName: testUser.userLogin,
            });
            const token = (0, testHelpers_1.createTestToken)(testUser);
            const response = await (0, supertest_1.default)(app)
                .post('/api/bot/remove')
                .set('Authorization', `Bearer ${token}`)
                .expect(200);
            (0, globals_1.expect)(response.body.success).toBe(true);
            (0, globals_1.expect)(response.body.message).toContain('removed');
            // Verify bot was deactivated
            const doc = await db.collection('managedChannels').doc(testUser.userLogin).get();
            (0, globals_1.expect)(doc.data().isActive).toBe(false);
        });
    });
});
//# sourceMappingURL=bot.integration.test.js.map