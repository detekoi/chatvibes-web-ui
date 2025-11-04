/**
 * Integration tests for bot API endpoints
 */

import {describe, it, expect, beforeAll, beforeEach} from '@jest/globals';
import request from 'supertest';
import {createTestApp} from './appHelper';
import {createTestToken, createTestUser, getTestDb, clearTestData} from './testHelpers';

describe('Bot API Integration Tests', () => {
  let app: any;
  let db: any;
  const testUser = createTestUser('teststreamer');

  beforeAll(async () => {
    app = await createTestApp();
    db = getTestDb();
  });

  beforeEach(async () => {
    await clearTestData();
  });

  describe('GET /api/bot/status', () => {
    it('should return 401 without token', async () => {
      const response = await request(app)
          .get('/api/bot/status')
          .expect(401);
      
      expect(response.body.success).toBe(false);
    });

    it('should return inactive status when bot is not active', async () => {
      const token = createTestToken(testUser);
      const response = await request(app)
          .get('/api/bot/status')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.isActive).toBe(false);
    });

    it('should return active status when bot is active', async () => {
      await db.collection('managedChannels').doc(testUser.userLogin).set({
        twitchUserId: testUser.userId,
        twitchUserLogin: testUser.userLogin,
        isActive: true,
        channelName: testUser.userLogin,
      });

      const token = createTestToken(testUser);
      const response = await request(app)
          .get('/api/bot/status')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.isActive).toBe(true);
      expect(response.body.channelName).toBe(testUser.userLogin);
    });
  });

  describe('POST /api/bot/add', () => {
    it('should return 401 without token', async () => {
      const response = await request(app)
          .post('/api/bot/add')
          .expect(401);
      
      expect(response.body.success).toBe(false);
    });

    // Note: Full testing of /api/bot/add requires:
    // - Mocking Twitch API calls (getValidTwitchTokenForUser, getUserIdFromUsername, addModerator)
    // - Mocking getAllowedChannelsList
    // These are tested in unit tests for the twitch service
    it('should return 401 with invalid token', async () => {
      const response = await request(app)
          .post('/api/bot/add')
          .set('Authorization', 'Bearer invalid-token')
          .expect(401);
      
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/bot/remove', () => {
    it('should return 401 without token', async () => {
      const response = await request(app)
          .post('/api/bot/remove')
          .expect(401);
      
      expect(response.body.success).toBe(false);
    });

    it('should remove bot when user exists', async () => {
      await db.collection('managedChannels').doc(testUser.userLogin).set({
        twitchUserId: testUser.userId,
        twitchUserLogin: testUser.userLogin,
        isActive: true,
        channelName: testUser.userLogin,
      });

      const token = createTestToken(testUser);
      const response = await request(app)
          .post('/api/bot/remove')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('removed');

      // Verify bot was deactivated
      const doc = await db.collection('managedChannels').doc(testUser.userLogin).get();
      expect(doc.data().isActive).toBe(false);
    });
  });
});

