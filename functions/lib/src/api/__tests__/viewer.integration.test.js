"use strict";
/**
 * Integration tests for viewer API endpoints
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const supertest_1 = __importDefault(require("supertest"));
const appHelper_1 = require("./appHelper");
const testHelpers_1 = require("./testHelpers");
(0, globals_1.describe)('Viewer API Integration Tests', () => {
    let app;
    let db;
    const testUser = (0, testHelpers_1.createTestUser)('testviewer');
    const testChannel = 'testchannel';
    (0, globals_1.beforeAll)(async () => {
        app = await (0, appHelper_1.createTestApp)();
        db = (0, testHelpers_1.getTestDb)();
    });
    (0, globals_1.beforeEach)(async () => {
        await (0, testHelpers_1.clearTestData)();
    });
    (0, globals_1.describe)('POST /api/viewer/auth', () => {
        (0, globals_1.it)('should return 400 when token is missing', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/viewer/auth')
                .send({})
                .expect(400);
            (0, globals_1.expect)(response.body.error).toBe('Token is required');
        });
        (0, globals_1.it)('should return success when token is provided', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/viewer/auth')
                .send({ token: 'test-token' })
                .expect(200);
            (0, globals_1.expect)(response.body.success).toBe(true);
            (0, globals_1.expect)(response.body.message).toContain('authenticated');
        });
    });
    (0, globals_1.describe)('GET /api/viewer/preferences/:channel', () => {
        (0, globals_1.it)('should return 401 without token', async () => {
            const response = await (0, supertest_1.default)(app)
                .get(`/api/viewer/preferences/${testChannel}`)
                .expect(401);
            (0, globals_1.expect)(response.body.success).toBe(false);
        });
        (0, globals_1.it)('should return preferences when they exist', async () => {
            await db.collection('ttsUserPreferences').doc(testUser.userLogin).set({
                speed: 1.0,
                pitch: 0,
                emotion: 'neutral',
            });
            await db.collection('ttsChannelConfigs').doc(testChannel).set({
                voiceId: 'test-voice',
                speed: 1.2,
            });
            const token = (0, testHelpers_1.createTestToken)(testUser);
            const response = await (0, supertest_1.default)(app)
                .get(`/api/viewer/preferences/${testChannel}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);
            (0, globals_1.expect)(response.body.success).toBe(true);
            (0, globals_1.expect)(response.body.preferences).toBeDefined();
        });
        (0, globals_1.it)('should return empty preferences when none exist', async () => {
            const token = (0, testHelpers_1.createTestToken)(testUser);
            const response = await (0, supertest_1.default)(app)
                .get(`/api/viewer/preferences/${testChannel}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);
            (0, globals_1.expect)(response.body.success).toBe(true);
            (0, globals_1.expect)(response.body.preferences).toBeDefined();
        });
    });
    (0, globals_1.describe)('PUT /api/viewer/preferences/:channel', () => {
        (0, globals_1.it)('should return 401 without token', async () => {
            const response = await (0, supertest_1.default)(app)
                .put(`/api/viewer/preferences/${testChannel}`)
                .send({ speed: 1.0 })
                .expect(401);
            (0, globals_1.expect)(response.body.success).toBe(false);
        });
        (0, globals_1.it)('should update preferences with valid data', async () => {
            const token = (0, testHelpers_1.createTestToken)(testUser);
            const response = await (0, supertest_1.default)(app)
                .put(`/api/viewer/preferences/${testChannel}`)
                .set('Authorization', `Bearer ${token}`)
                .send({
                speed: 1.2,
                pitch: 5,
                emotion: 'happy',
            })
                .expect(200);
            (0, globals_1.expect)(response.body.success).toBe(true);
            // Verify preferences were saved
            const doc = await db.collection('ttsUserPreferences').doc(testUser.userLogin).get();
            const data = doc.data();
            (0, globals_1.expect)(data.speed).toBe(1.2);
            (0, globals_1.expect)(data.pitch).toBe(5);
        });
        (0, globals_1.it)('should return 400 for invalid speed', async () => {
            const token = (0, testHelpers_1.createTestToken)(testUser);
            const response = await (0, supertest_1.default)(app)
                .put(`/api/viewer/preferences/${testChannel}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ speed: 5.0 }) // Invalid: too high
                .expect(400);
            (0, globals_1.expect)(response.body.error).toBeDefined();
        });
        (0, globals_1.it)('should return 400 for invalid pitch', async () => {
            const token = (0, testHelpers_1.createTestToken)(testUser);
            const response = await (0, supertest_1.default)(app)
                .put(`/api/viewer/preferences/${testChannel}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ pitch: 50 }) // Invalid: too high
                .expect(400);
            (0, globals_1.expect)(response.body.error).toBeDefined();
        });
    });
});
//# sourceMappingURL=viewer.integration.test.js.map