/**
 * User voice lookup: resolves the login to a Twitch user ID and reads the
 * preferences stored under that ID. A login-keyed document is never read.
 */

import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';

const mockGetUserIdFromUsername = jest.fn<any>();
jest.mock('../../services/twitch', () => ({
  ...(jest.requireActual('../../services/twitch') as object),
  getUserIdFromUsername: mockGetUserIdFromUsername,
}));

import request from 'supertest';
import { createTestApp } from './appHelper';
import { createTestToken, createTestUser, getTestDb, clearTestData } from './testHelpers';

describe('User Voice Lookup', () => {
    let app: any;
    let db: any;
    const testUser = createTestUser('testuser');
    const username = 'pedromarvarez';
    const userId = '424242';

    beforeAll(async () => {
        app = await createTestApp();
        db = getTestDb();
    });

    beforeEach(async () => {
        await clearTestData();
        mockGetUserIdFromUsername.mockReset();
        mockGetUserIdFromUsername.mockResolvedValue(userId);
    });

    describe('GET /api/tts/user-voice/:username', () => {
        it('should return 200 with no voice when none is set', async () => {
            const response = await request(app)
                .get(`/api/tts/user-voice/${username}`)
                .set('Authorization', `Bearer ${createTestToken(testUser)}`)
                .expect(200);

            expect(response.body.success).toBe(true);
            expect(response.body.username).toBe(username);
            expect(response.body.voiceId).toBeNull();
        });

        it('should return the voice stored under the user ID', async () => {
            await db.collection('ttsUserPreferences').doc(userId).set({ voiceId: 'Test_Voice_ID' });

            const response = await request(app)
                .get(`/api/tts/user-voice/${username}`)
                .set('Authorization', `Bearer ${createTestToken(testUser)}`)
                .expect(200);

            expect(mockGetUserIdFromUsername).toHaveBeenCalledWith(username, expect.anything());
            expect(response.body.voiceId).toBe('Test_Voice_ID');
        });

        it('should ignore a legacy document keyed by login', async () => {
            await db.collection('ttsUserPreferences').doc(username).set({ voiceId: 'Legacy_Voice' });

            const response = await request(app)
                .get(`/api/tts/user-voice/${username}`)
                .set('Authorization', `Bearer ${createTestToken(testUser)}`)
                .expect(200);

            expect(response.body.voiceId).toBeNull();
        });

        it('should return no voice when the login does not resolve', async () => {
            mockGetUserIdFromUsername.mockResolvedValue(null);
            await db.collection('ttsUserPreferences').doc(username).set({ voiceId: 'Legacy_Voice' });

            const response = await request(app)
                .get(`/api/tts/user-voice/${username}`)
                .set('Authorization', `Bearer ${createTestToken(testUser)}`)
                .expect(200);

            expect(response.body.voiceId).toBeNull();
        });
    });
});
