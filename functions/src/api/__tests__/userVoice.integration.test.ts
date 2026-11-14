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
import { loadLegacyVoiceMap } from '../../services/voices';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// The synced MiniMax map is optional, so the tests bring their own.
const legacyMapFile = join(mkdtempSync(join(tmpdir(), 'voice-map-')), 'map.json');
writeFileSync(legacyMapFile, JSON.stringify({ 'Friendly_Person': { voice: 'kore', style: 'warm and friendly' } }));

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
        loadLegacyVoiceMap([legacyMapFile]);
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
            await db.collection('ttsUserPreferences').doc(userId).set({ voiceId: 'kore' });

            const response = await request(app)
                .get(`/api/tts/user-voice/${username}`)
                .set('Authorization', `Bearer ${createTestToken(testUser)}`)
                .expect(200);

            expect(mockGetUserIdFromUsername).toHaveBeenCalledWith(username, expect.anything());
            expect(response.body).toEqual({ success: true, username, voiceId: 'kore' });
        });

        it('should return the Gemini voice of a stored MiniMax ID, and the stored ID', async () => {
            await db.collection('ttsUserPreferences').doc(userId).set({ voiceId: 'Friendly_Person', voiceStyle: 'warm and friendly' });

            const response = await request(app)
                .get(`/api/tts/user-voice/${username}`)
                .set('Authorization', `Bearer ${createTestToken(testUser)}`)
                .expect(200);

            expect(response.body).toEqual({ success: true, username, voiceId: 'kore', storedVoiceId: 'Friendly_Person' });
        });

        it('should return the default voice for a stored ID that no catalog knows', async () => {
            await db.collection('ttsUserPreferences').doc(userId).set({ voiceId: 'Not_A_Real_Voice' });

            const response = await request(app)
                .get(`/api/tts/user-voice/${username}`)
                .set('Authorization', `Bearer ${createTestToken(testUser)}`)
                .expect(200);

            expect(response.body).toEqual({ success: true, username, voiceId: 'puck', storedVoiceId: 'Not_A_Real_Voice' });
        });

        it('should return only the voice, never the rest of the document', async () => {
            // Any signed-in broadcaster can look up any login here.
            await db.collection('ttsUserPreferences').doc(userId).set({
                voiceId: 'kore',
                pitch: 2,
                globalOptOut: true,
                globalOptOutAt: '2026-01-01T00:00:00.000Z',
            });

            const response = await request(app)
                .get(`/api/tts/user-voice/${username}`)
                .set('Authorization', `Bearer ${createTestToken(testUser)}`)
                .expect(200);

            expect(response.body).toEqual({ success: true, username, voiceId: 'kore' });
        });

        it('should answer the same for an opted-out viewer with no voice as for no document', async () => {
            // A different shape would tell the broadcaster that the viewer opted out.
            const token = createTestToken(testUser);
            const none = await request(app)
                .get(`/api/tts/user-voice/${username}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            await db.collection('ttsUserPreferences').doc(userId).set({
                globalOptOut: true,
                globalOptOutAt: '2026-01-01T00:00:00.000Z',
            });
            const optedOut = await request(app)
                .get(`/api/tts/user-voice/${username}`)
                .set('Authorization', `Bearer ${token}`)
                .expect(200);

            expect(optedOut.body).toEqual(none.body);
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
