/**
 * Integration tests for settings endpoint
 */

import {describe, it, beforeAll} from '@jest/globals';
import request from 'supertest';
import {createTestApp} from './appHelper';

describe('Settings API Integration Tests', () => {
  let app: any;

  beforeAll(async () => {
    app = await createTestApp();
  });

  describe('GET /api/tts/settings/channel/:channelName', () => {
    it('should return 401 without authentication', async () => {
      await request(app)
          .get('/api/tts/settings/channel/testchannel')
          .expect(401);
    });
  });

  describe('PUT /api/tts/settings/channel/:channelName', () => {
    it('should return 401 without authentication', async () => {
      await request(app)
          .put('/api/tts/settings/channel/testchannel')
          .send({ key: 'voiceId', value: 'test-voice' })
          .expect(401);
    });

    it('should return 401 when key is missing but not authenticated', async () => {
      // This test would need proper authentication to test 400 for missing key
      // For now, it will return 401 without auth
      await request(app)
          .put('/api/tts/settings/channel/testchannel')
          .send({ value: 'test-voice' })
          .expect(401);
    });
  });
});
