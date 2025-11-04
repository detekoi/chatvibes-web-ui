/**
 * Integration tests for viewer API endpoints
 */

import {describe, it, expect, beforeAll, beforeEach} from '@jest/globals';
import request from 'supertest';
import {createTestApp} from './appHelper';
import {createTestToken, createTestUser, getTestDb, clearTestData} from './testHelpers';

describe('Viewer API Integration Tests', () => {
  let app: any;
  let db: any;
  const testUser = createTestUser('testviewer');
  const testChannel = 'testchannel';

  beforeAll(async () => {
    app = await createTestApp();
    db = getTestDb();
  });

  beforeEach(async () => {
    await clearTestData();
  });

  describe('POST /api/viewer/auth', () => {
    it('should return 400 when token is missing', async () => {
      const response = await request(app)
          .post('/api/viewer/auth')
          .send({})
          .expect(400);
      
      expect(response.body.error).toBe('Token is required');
    });

    it('should return success when token is provided', async () => {
      const response = await request(app)
          .post('/api/viewer/auth')
          .send({token: 'test-token'})
          .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('authenticated');
    });
  });

  describe('GET /api/viewer/preferences/:channel', () => {
    it('should return 401 without token', async () => {
      const response = await request(app)
          .get(`/api/viewer/preferences/${testChannel}`)
          .expect(401);
      
      expect(response.body.success).toBe(false);
    });

    it('should return preferences when they exist', async () => {
      await db.collection('ttsUserPreferences').doc(testUser.userLogin).set({
        speed: 1.0,
        pitch: 0,
        emotion: 'neutral',
      });

      await db.collection('ttsChannelConfigs').doc(testChannel).set({
        voiceId: 'test-voice',
        speed: 1.2,
      });

      const token = createTestToken(testUser);
      const response = await request(app)
          .get(`/api/viewer/preferences/${testChannel}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.preferences).toBeDefined();
    });

    it('should return empty preferences when none exist', async () => {
      const token = createTestToken(testUser);
      const response = await request(app)
          .get(`/api/viewer/preferences/${testChannel}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.preferences).toBeDefined();
    });
  });

  describe('PUT /api/viewer/preferences/:channel', () => {
    it('should return 401 without token', async () => {
      const response = await request(app)
          .put(`/api/viewer/preferences/${testChannel}`)
          .send({speed: 1.0})
          .expect(401);
      
      expect(response.body.success).toBe(false);
    });

    it('should update preferences with valid data', async () => {
      const token = createTestToken(testUser);
      const response = await request(app)
          .put(`/api/viewer/preferences/${testChannel}`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            speed: 1.2,
            pitch: 5,
            emotion: 'happy',
          })
          .expect(200);
      
      expect(response.body.success).toBe(true);

      // Verify preferences were saved
      const doc = await db.collection('ttsUserPreferences').doc(testUser.userLogin).get();
      const data = doc.data();
      expect(data.speed).toBe(1.2);
      expect(data.pitch).toBe(5);
    });

    it('should return 400 for invalid speed', async () => {
      const token = createTestToken(testUser);
      const response = await request(app)
          .put(`/api/viewer/preferences/${testChannel}`)
          .set('Authorization', `Bearer ${token}`)
          .send({speed: 5.0}) // Invalid: too high
          .expect(400);
      
      expect(response.body.error).toBeDefined();
    });

    it('should return 400 for invalid pitch', async () => {
      const token = createTestToken(testUser);
      const response = await request(app)
          .put(`/api/viewer/preferences/${testChannel}`)
          .set('Authorization', `Bearer ${token}`)
          .send({pitch: 50}) // Invalid: too high
          .expect(400);
      
      expect(response.body.error).toBeDefined();
    });
  });
});

