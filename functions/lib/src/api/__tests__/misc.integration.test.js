"use strict";
/**
 * Integration tests for miscellaneous API endpoints (shortlinks, TTS test)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const supertest_1 = __importDefault(require("supertest"));
const appHelper_1 = require("./appHelper");
const testHelpers_1 = require("./testHelpers");
(0, globals_1.describe)('Misc API Integration Tests', () => {
    let app;
    let db;
    const testUser = (0, testHelpers_1.createTestUser)('testuser');
    (0, globals_1.beforeAll)(async () => {
        app = await (0, appHelper_1.createTestApp)();
        db = (0, testHelpers_1.getTestDb)();
    });
    (0, globals_1.beforeEach)(async () => {
        await (0, testHelpers_1.clearTestData)();
    });
    (0, globals_1.describe)('POST /api/shortlink', () => {
        (0, globals_1.it)('should return 401 without token', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/shortlink')
                .send({ url: 'https://example.com' })
                .expect(401);
            (0, globals_1.expect)(response.body.success).toBe(false);
        });
        (0, globals_1.it)('should return 400 when URL is missing', async () => {
            const token = (0, testHelpers_1.createTestToken)(testUser);
            const response = await (0, supertest_1.default)(app)
                .post('/api/shortlink')
                .set('Authorization', `Bearer ${token}`)
                .send({})
                .expect(400);
            (0, globals_1.expect)(response.body.error).toBe('URL is required');
        });
        (0, globals_1.it)('should create shortlink with valid URL', async () => {
            const token = (0, testHelpers_1.createTestToken)(testUser);
            const testUrl = 'https://example.com/test';
            const response = await (0, supertest_1.default)(app)
                .post('/api/shortlink')
                .set('Authorization', `Bearer ${token}`)
                .send({ url: testUrl })
                .expect(200);
            (0, globals_1.expect)(response.body.success).toBe(true);
            (0, globals_1.expect)(response.body.slug).toBeDefined();
            (0, globals_1.expect)(response.body.shortUrl).toBeDefined();
            (0, globals_1.expect)(response.body.absoluteUrl).toBeDefined();
            // Verify shortlink was created in Firestore
            const slug = response.body.slug;
            const doc = await db.collection('shortlinks').doc(slug).get();
            (0, globals_1.expect)(doc.exists).toBe(true);
            (0, globals_1.expect)(doc.data().url).toBe(testUrl);
        });
    });
    (0, globals_1.describe)('GET /s/:slug', () => {
        (0, globals_1.it)('should return 404 for non-existent slug', async () => {
            const response = await (0, supertest_1.default)(app)
                .get('/s/nonexistent')
                .expect(404);
            (0, globals_1.expect)(response.text).toContain('not found');
        });
        (0, globals_1.it)('should redirect to URL for valid slug', async () => {
            const testUrl = 'https://example.com/redirect-test';
            const slug = 'test-slug-123';
            await db.collection('shortlinks').doc(slug).set({
                url: testUrl,
                clicks: 0,
            });
            const response = await (0, supertest_1.default)(app)
                .get(`/s/${slug}`)
                .expect(301);
            (0, globals_1.expect)(response.headers.location).toBe(testUrl);
            // Verify click counter was incremented
            const doc = await db.collection('shortlinks').doc(slug).get();
            (0, globals_1.expect)(doc.data().clicks).toBe(1);
        });
    });
    (0, globals_1.describe)('POST /api/tts/test', () => {
        (0, globals_1.it)('should return 401 without token', async () => {
            const response = await (0, supertest_1.default)(app)
                .post('/api/tts/test')
                .send({ text: 'Hello world' })
                .expect(401);
            (0, globals_1.expect)(response.body.success).toBe(false);
        });
        (0, globals_1.it)('should return 400 when text is missing', async () => {
            const token = (0, testHelpers_1.createTestToken)(testUser);
            const response = await (0, supertest_1.default)(app)
                .post('/api/tts/test')
                .set('Authorization', `Bearer ${token}`)
                .send({})
                .expect(400);
            (0, globals_1.expect)(response.body.success).toBe(false);
            (0, globals_1.expect)(response.body.error).toContain('Text is required');
        });
        // Note: Full TTS test requires WAVESPEED_API_KEY to be set
        // Without it, the endpoint returns 501 (Not Implemented)
        (0, globals_1.it)('should return 501 when TTS provider not configured', async () => {
            // Ensure WAVESPEED_API_KEY is not set
            const originalKey = process.env.WAVESPEED_API_KEY;
            delete process.env.WAVESPEED_API_KEY;
            // Reload config
            delete require.cache[require.resolve('../../config')];
            const token = (0, testHelpers_1.createTestToken)(testUser);
            const response = await (0, supertest_1.default)(app)
                .post('/api/tts/test')
                .set('Authorization', `Bearer ${token}`)
                .send({ text: 'Hello world' })
                .expect(501);
            (0, globals_1.expect)(response.body.success).toBe(false);
            (0, globals_1.expect)(response.body.error).toContain('TTS provider not configured');
            // Restore original key
            if (originalKey) {
                process.env.WAVESPEED_API_KEY = originalKey;
            }
        });
    });
});
//# sourceMappingURL=misc.integration.test.js.map