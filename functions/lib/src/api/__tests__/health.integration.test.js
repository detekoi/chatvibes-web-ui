"use strict";
/**
 * Integration tests for health endpoint
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const supertest_1 = __importDefault(require("supertest"));
const appHelper_1 = require("./appHelper");
(0, globals_1.describe)('Health Endpoint Integration Tests', () => {
    let app;
    (0, globals_1.beforeAll)(async () => {
        app = await (0, appHelper_1.createTestApp)();
    });
    (0, globals_1.it)('should return healthy status', async () => {
        const response = await (0, supertest_1.default)(app)
            .get('/health')
            .expect(200);
        (0, globals_1.expect)(response.body.status).toBe('healthy');
        (0, globals_1.expect)(response.body.service).toBe('chatvibes-web-ui-functions');
        (0, globals_1.expect)(response.body.timestamp).toBeDefined();
    });
    (0, globals_1.it)('should handle health check with proper CORS', async () => {
        const response = await (0, supertest_1.default)(app)
            .get('/health')
            .set('Origin', 'http://localhost:5002')
            .expect(200);
        (0, globals_1.expect)(response.body.status).toBe('healthy');
        (0, globals_1.expect)(response.headers['access-control-allow-origin']).toBeDefined();
    });
    (0, globals_1.it)('should return 404 for unknown endpoint', async () => {
        const response = await (0, supertest_1.default)(app)
            .get('/unknown-endpoint')
            .expect(404);
        (0, globals_1.expect)(response.body.success).toBe(false);
        (0, globals_1.expect)(response.body.error).toBe('Endpoint not found');
    });
});
//# sourceMappingURL=health.integration.test.js.map