/**
 * Integration tests for auth API endpoints
 */

import {describe, it, expect, beforeAll, beforeEach} from '@jest/globals';
import request from 'supertest';
import {createTestApp} from './appHelper';
import {createTestToken, createTestUser, getTestDb, clearTestData} from './testHelpers';
import * as admin from 'firebase-admin';

describe('Auth API Integration Tests', () => {
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

  describe('GET /api/auth/status', () => {
    it('should return 401 without token', async () => {
      const response = await request(app)
          .get('/api/auth/status')
          .expect(401);
      
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Unauthorized');
    });

    it('should return 401 with invalid token', async () => {
      const response = await request(app)
          .get('/api/auth/status')
          .set('Authorization', 'Bearer invalid-token')
          .expect(401);
      
      expect(response.body.success).toBe(false);
    });

    it('should return user status for valid token when user exists', async () => {
      // Create user in Firestore
      await db.collection('managedChannels').doc(testUser.userLogin).set({
        twitchUserId: testUser.userId,
        twitchUserLogin: testUser.userLogin,
        isActive: true,
        needsTwitchReAuth: false,
      });

      const token = createTestToken(testUser);
      const response = await request(app)
          .get('/api/auth/status')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.user.userLogin).toBe(testUser.userLogin);
      expect(response.body.twitchTokenStatus).toBeDefined();
    });

    it('should return not_found status when user does not exist', async () => {
      const token = createTestToken(testUser);
      const response = await request(app)
          .get('/api/auth/status')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.twitchTokenStatus).toBe('not_found');
      expect(response.body.needsTwitchReAuth).toBe(true);
    });

    it('should return expired status when token is expired', async () => {
      await db.collection('managedChannels').doc(testUser.userLogin).set({
        twitchUserId: testUser.userId,
        twitchUserLogin: testUser.userLogin,
        isActive: true,
        needsTwitchReAuth: false,
        twitchAccessTokenExpiresAt: admin.firestore.Timestamp.fromDate(new Date(Date.now() - 1000)), // Expired
      });

      const token = createTestToken(testUser);
      const response = await request(app)
          .get('/api/auth/status')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.twitchTokenStatus).toBe('expired');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should return 401 without token', async () => {
      const response = await request(app)
          .post('/api/auth/refresh')
          .expect(401);
      
      expect(response.body.success).toBe(false);
    });

    // Note: Testing actual token refresh would require mocking Twitch API calls
    // This is tested in unit tests for the twitch service
    it('should return 401 with invalid token', async () => {
      const response = await request(app)
          .post('/api/auth/refresh')
          .set('Authorization', 'Bearer invalid-token')
          .expect(401);
      
      expect(response.body.success).toBe(false);
    });
  });
});

