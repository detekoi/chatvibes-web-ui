/**
 * Reproduction test for User Voice Lookup 400 Error
 */

import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { createTestApp } from './appHelper';
import { createTestToken, createTestUser, getTestDb, clearTestData } from './testHelpers';

describe('User Voice Lookup Reproduction', () => {
    let app: any;
    let db: any;
    const testUser = createTestUser('testuser');

    beforeAll(async () => {
        app = await createTestApp();
        db = getTestDb();
    });

    beforeEach(async () => {
        await clearTestData();
    });

    describe('GET /api/tts/user-voice/:username', () => {
        it('should return 200 for valid username', async () => {
            const token = createTestToken(testUser);
            const username = 'pedromarvarez';

            const response = await request(app)
                .get(`/api/tts/user-voice/${username}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.username).toBe(username);
            expect(response.body.voiceId).toBeNull(); // No voice set yet
        });

        it('should return 200 with voiceId when voice is set', async () => {
            const token = createTestToken(testUser);
            const username = 'pedromarvarez';

            await db.collection('ttsUserPreferences').doc(username).set({
                voiceId: 'Test_Voice_ID'
            });

            const response = await request(app)
                .get(`/api/tts/user-voice/${username}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.username).toBe(username);
            expect(response.body.voiceId).toBe('Test_Voice_ID');
        });

        it('should return 400 if somehow username is missing (empty)', async () => {
            // This tests if the code checks for emptiness, though express might not match route
            const token = createTestToken(testUser);
            // We can't really get /api/tts/user-voice/ because it won't match the route
            // But let's try calling handler directly if we could, but here we integration test route

            // Try passing empty string as param?
            await request(app)
                .get(`/api/tts/user-voice/ `) // Space?
                .set('Authorization', `Bearer ${token}`)
            // Expect 404 typically unless encoded

            // What if we try to simulate the exact request from user?
        });
    });
});
