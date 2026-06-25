/**
 * Integration tests for settings endpoint
 */

import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';

jest.mock('../../services/firestore', () => {
  const mockDbInstance: any = {
    collection: jest.fn(),
    doc: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
  };
  mockDbInstance.collection.mockReturnValue(mockDbInstance);
  mockDbInstance.doc.mockReturnValue(mockDbInstance);

  return {
    db: mockDbInstance,
    COLLECTIONS: {
      TTS_CHANNEL_CONFIGS: 'ttsChannelConfigs',
    },
    FieldValue: {
      arrayUnion: jest.fn((val: any) => ({ type: 'arrayUnion', value: val })),
      arrayRemove: jest.fn((val: any) => ({ type: 'arrayRemove', value: val })),
    },
  };
});

import request from 'supertest';
import { createTestApp } from './appHelper';
import { createTestToken } from './testHelpers';
import { db, FieldValue } from '../../services/firestore';

describe('Settings API Integration Tests (Mocked Firestore)', () => {
  let app: any;
  let authToken: string;
  const channelName = 'testchannel';
  const testUser = {
    userId: 'user-123',
    userLogin: channelName,
    displayName: 'TestChannel',
  };

  beforeAll(async () => {
    app = await createTestApp();
    authToken = createTestToken(testUser);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ((db as any).collection as any).mockReturnValue(db);
    ((db as any).doc as any).mockReturnValue(db);
    (FieldValue.arrayUnion as any).mockImplementation((val: any) => ({ type: 'arrayUnion', value: val }));
    (FieldValue.arrayRemove as any).mockImplementation((val: any) => ({ type: 'arrayRemove', value: val }));
  });

  describe('GET /api/tts/settings/channel/:channelName', () => {
    it('should return 401 without authentication', async () => {
      await request(app)
        .get(`/api/tts/settings/channel/${channelName}`)
        .expect(401);
    });

    it('should return 403 if userLogin does not match channelName', async () => {
      const wrongToken = createTestToken({
        userId: 'user-456',
        userLogin: 'differentchannel',
      });

      await request(app)
        .get(`/api/tts/settings/channel/${channelName}`)
        .set('Authorization', `Bearer ${wrongToken}`)
        .expect(403);
    });

    it('should fetch settings successfully (happy path)', async () => {
      const mockSettings = { voiceId: 'brian', rate: 1.1 };
      ((db as any).get as any).mockResolvedValueOnce({
        exists: true,
        data: () => mockSettings,
      });

      const response = await request(app)
        .get(`/api/tts/settings/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual({ settings: mockSettings });
      expect(db.collection).toHaveBeenCalledWith('ttsChannelConfigs');
      expect(db.doc).toHaveBeenCalledWith(testUser.userId);
    });

    it('should return empty settings if document does not exist', async () => {
      ((db as any).get as any).mockResolvedValueOnce({
        exists: false,
      });

      const response = await request(app)
        .get(`/api/tts/settings/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual({ settings: {} });
    });
  });

  describe('PUT /api/tts/settings/channel/:channelName', () => {
    it('should return 401 without authentication', async () => {
      await request(app)
        .put(`/api/tts/settings/channel/${channelName}`)
        .send({ key: 'voiceId', value: 'test-voice' })
        .expect(401);
    });

    it('should return 400 when key is missing', async () => {
      await request(app)
        .put(`/api/tts/settings/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ value: 'test-voice' })
        .expect(400);
    });

    it('should atomically update setting (happy path)', async () => {
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .put(`/api/tts/settings/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ key: 'voiceId', value: 'test-voice' })
        .expect(200);

      expect(response.body).toEqual({ success: true, message: 'Setting updated' });
      expect(db.collection).toHaveBeenCalledWith('ttsChannelConfigs');
      expect(db.doc).toHaveBeenCalledWith(testUser.userId);
      expect((db as any).set).toHaveBeenCalledWith({ voiceId: 'test-voice' }, { merge: true });
    });
  });

  describe('POST /api/tts/ignore/channel/:channelName', () => {
    it('should return 401 without authentication', async () => {
      await request(app)
        .post(`/api/tts/ignore/channel/${channelName}`)
        .send({ username: 'spammer' })
        .expect(401);
    });

    it('should return 400 if username is missing', async () => {
      await request(app)
        .post(`/api/tts/ignore/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);
    });

    it('should atomically add user to ignore list (happy path)', async () => {
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .post(`/api/tts/ignore/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ username: 'Spammer' })
        .expect(200);

      expect(response.body).toEqual({ success: true, message: 'User added to ignore list' });
      expect(db.collection).toHaveBeenCalledWith('ttsChannelConfigs');
      expect(db.doc).toHaveBeenCalledWith(testUser.userId);
      expect(FieldValue.arrayUnion).toHaveBeenCalledWith('spammer');
      expect((db as any).set).toHaveBeenCalledWith(
        { ignoredUsers: { type: 'arrayUnion', value: 'spammer' } },
        { merge: true }
      );
    });
  });

  describe('DELETE /api/tts/ignore/channel/:channelName', () => {
    it('should return 401 without authentication', async () => {
      await request(app)
        .delete(`/api/tts/ignore/channel/${channelName}`)
        .send({ username: 'spammer' })
        .expect(401);
    });

    it('should atomically remove user from ignore list (happy path)', async () => {
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .delete(`/api/tts/ignore/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ username: 'Spammer' })
        .expect(200);

      expect(response.body).toEqual({ success: true, message: 'User removed from ignore list' });
      expect(db.collection).toHaveBeenCalledWith('ttsChannelConfigs');
      expect(db.doc).toHaveBeenCalledWith(testUser.userId);
      expect(FieldValue.arrayRemove).toHaveBeenCalledWith('spammer');
      expect((db as any).set).toHaveBeenCalledWith(
        { ignoredUsers: { type: 'arrayRemove', value: 'spammer' } },
        { merge: true }
      );
    });
  });

  describe('POST /api/tts/banned-words/channel/:channelName', () => {
    it('should return 401 without authentication', async () => {
      await request(app)
        .post(`/api/tts/banned-words/channel/${channelName}`)
        .send({ word: 'badword' })
        .expect(401);
    });

    it('should atomically add word to banned list (happy path)', async () => {
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .post(`/api/tts/banned-words/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ word: ' BadWord ' })
        .expect(200);

      expect(response.body).toEqual({ success: true, message: 'Word added to banned list' });
      expect(db.collection).toHaveBeenCalledWith('ttsChannelConfigs');
      expect(db.doc).toHaveBeenCalledWith(testUser.userId);
      expect(FieldValue.arrayUnion).toHaveBeenCalledWith('badword');
      expect((db as any).set).toHaveBeenCalledWith(
        { bannedWords: { type: 'arrayUnion', value: 'badword' } },
        { merge: true }
      );
    });
  });

  describe('DELETE /api/tts/banned-words/channel/:channelName', () => {
    it('should return 401 without authentication', async () => {
      await request(app)
        .delete(`/api/tts/banned-words/channel/${channelName}`)
        .send({ word: 'badword' })
        .expect(401);
    });

    it('should atomically remove word from banned list (happy path)', async () => {
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .delete(`/api/tts/banned-words/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ word: ' BadWord ' })
        .expect(200);

      expect(response.body).toEqual({ success: true, message: 'Word removed from banned list' });
      expect(db.collection).toHaveBeenCalledWith('ttsChannelConfigs');
      expect(db.doc).toHaveBeenCalledWith(testUser.userId);
      expect(FieldValue.arrayRemove).toHaveBeenCalledWith('badword');
      expect((db as any).set).toHaveBeenCalledWith(
        { bannedWords: { type: 'arrayRemove', value: 'badword' } },
        { merge: true }
      );
    });
  });
});
