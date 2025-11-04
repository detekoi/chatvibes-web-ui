/**
 * Integration tests for miscellaneous API endpoints (shortlinks, TTS test)
 */

import {describe, it, expect, beforeAll, beforeEach} from '@jest/globals';
import request from 'supertest';
import {createTestApp} from './appHelper';
import {createTestToken, createTestUser, getTestDb, clearTestData} from './testHelpers';

describe('Misc API Integration Tests', () => {
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

  describe('POST /api/shortlink', () => {
    it('should return 401 without token', async () => {
      const response = await request(app)
          .post('/api/shortlink')
          .send({url: 'https://example.com'})
          .expect(401);
      
      expect(response.body.success).toBe(false);
    });

    it('should return 400 when URL is missing', async () => {
      const token = createTestToken(testUser);
      const response = await request(app)
          .post('/api/shortlink')
          .set('Authorization', `Bearer ${token}`)
          .send({})
          .expect(400);
      
      expect(response.body.error).toBe('URL is required');
    });

    it('should create shortlink with valid URL', async () => {
      const token = createTestToken(testUser);
      const testUrl = 'https://example.com/test';
      const response = await request(app)
          .post('/api/shortlink')
          .set('Authorization', `Bearer ${token}`)
          .send({url: testUrl})
          .expect(200);
      
      expect(response.body.success).toBe(true);
      expect(response.body.slug).toBeDefined();
      expect(response.body.shortUrl).toBeDefined();
      expect(response.body.absoluteUrl).toBeDefined();

      // Verify shortlink was created in Firestore
      const slug = response.body.slug;
      const doc = await db.collection('shortlinks').doc(slug).get();
      expect(doc.exists).toBe(true);
      expect(doc.data().url).toBe(testUrl);
    });
  });

  describe('GET /s/:slug', () => {
    it('should return 404 for non-existent slug', async () => {
      const response = await request(app)
          .get('/s/nonexistent')
          .expect(404);
      
      expect(response.text).toContain('not found');
    });

    it('should redirect to URL for valid slug', async () => {
      const testUrl = 'https://example.com/redirect-test';
      const slug = 'test-slug-123';
      
      await db.collection('shortlinks').doc(slug).set({
        url: testUrl,
        clicks: 0,
      });

      const response = await request(app)
          .get(`/s/${slug}`)
          .expect(301);
      
      expect(response.headers.location).toBe(testUrl);

      // Verify click counter was incremented
      const doc = await db.collection('shortlinks').doc(slug).get();
      expect(doc.data().clicks).toBe(1);
    });
  });

  describe('POST /api/tts/test', () => {
    it('should return 401 without token', async () => {
      const response = await request(app)
          .post('/api/tts/test')
          .send({text: 'Hello world'})
          .expect(401);
      
      expect(response.body.success).toBe(false);
    });

    it('should return 400 when text is missing', async () => {
      const token = createTestToken(testUser);
      const response = await request(app)
          .post('/api/tts/test')
          .set('Authorization', `Bearer ${token}`)
          .send({})
          .expect(400);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Text is required');
    });

    // Note: Full TTS test requires WAVESPEED_API_KEY to be set
    // Without it, the endpoint returns 501 (Not Implemented)
    it('should return 501 when TTS provider not configured', async () => {
      // Ensure WAVESPEED_API_KEY is not set
      const originalKey = process.env.WAVESPEED_API_KEY;
      delete process.env.WAVESPEED_API_KEY;
      
      // Reload config
      delete require.cache[require.resolve('../../config')];
      
      const token = createTestToken(testUser);
      const response = await request(app)
          .post('/api/tts/test')
          .set('Authorization', `Bearer ${token}`)
          .send({text: 'Hello world'})
          .expect(501);
      
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('TTS provider not configured');
      
      // Restore original key
      if (originalKey) {
        process.env.WAVESPEED_API_KEY = originalKey;
      }
    });
  });
});

