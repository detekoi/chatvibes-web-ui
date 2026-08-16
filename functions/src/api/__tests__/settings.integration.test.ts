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
    update: jest.fn(),
  };
  mockDbInstance.collection.mockReturnValue(mockDbInstance);
  mockDbInstance.doc.mockReturnValue(mockDbInstance);

  // Segments are kept as an array so assertions can inspect them; the real
  // FieldPath treats them literally, which is the whole point of using it.
  class MockFieldPath {
    segments: string[];
    constructor(...segments: string[]) {
      this.segments = segments;
    }
  }

  return {
    db: mockDbInstance,
    COLLECTIONS: {
      TTS_CHANNEL_CONFIGS: 'ttsChannelConfigs',
    },
    FieldValue: {
      arrayUnion: jest.fn((val: any) => ({ type: 'arrayUnion', value: val })),
      arrayRemove: jest.fn((val: any) => ({ type: 'arrayRemove', value: val })),
      delete: jest.fn(() => ({ type: 'delete' })),
    },
    FieldPath: MockFieldPath,
  };
});

// The ignore list keys on immutable Twitch user IDs, so adding an entry resolves
// the typed name through Helix first. Mocked here so the tests stay offline.
const mockGetUserByUsername = jest.fn<any>();
jest.mock('../../services/twitch', () => ({
  getUserByUsername: mockGetUserByUsername,
}));

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
    (FieldValue.delete as any).mockImplementation(() => ({ type: 'delete' }));
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
        .send({ key: 'voiceId', value: 'Friendly_Person' })
        .expect(401);
    });

    it('should return 400 when key is missing', async () => {
      await request(app)
        .put(`/api/tts/settings/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ value: 'Friendly_Person' })
        .expect(400);
    });

    it('should atomically update setting (happy path)', async () => {
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .put(`/api/tts/settings/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ key: 'voiceId', value: 'Friendly_Person' })
        .expect(200);

      expect(response.body).toEqual({ success: true, message: 'Setting updated' });
      expect(db.collection).toHaveBeenCalledWith('ttsChannelConfigs');
      expect(db.doc).toHaveBeenCalledWith(testUser.userId);
      expect((db as any).set).toHaveBeenCalledWith({ voiceId: 'Friendly_Person' }, { merge: true });
    });

    it.each([
      ['an unknown key', { key: 'notASetting', value: true }],
      ['a boolean setting given a string', { key: 'engineEnabled', value: 'yes' }],
      ['an out-of-range speed', { key: 'speed', value: 99 }],
      ['an unknown emote mode', { key: 'emoteMode', value: 'shout' }],
      ['a negative bits minimum', { key: 'bitsMinimumAmount', value: -1 }],
      ['an unknown voice', { key: 'voiceId', value: 'Not_A_Real_Voice' }],
      ['a volume for an unknown voice', { key: 'voiceVolumes.Not_A_Real_Voice', value: 2 }],
    ])('should reject %s without writing', async (_label, body) => {
      await request(app)
        .put(`/api/tts/settings/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(body)
        .expect(400);

      expect((db as any).set).not.toHaveBeenCalled();
    });

    it.each([
      ['auto', 'languageBoost', 'auto'],
      ['the dashboard\'s "Automatic" alias', 'languageBoost', 'Automatic'],
      ['a canonical emotion', 'emotion', 'happy'],
    ])('should accept %s', async (_label, key, value) => {
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      await request(app)
        .put(`/api/tts/settings/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ key, value })
        .expect(200);

      expect((db as any).set).toHaveBeenCalledWith({ [key]: value }, { merge: true });
    });

    it('should write a per-voice volume as a nested map, not a dotted field', async () => {
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      await request(app)
        .put(`/api/tts/settings/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ key: 'voiceVolumes.Friendly_Person', value: 2.5 })
        .expect(200);

      expect((db as any).set).toHaveBeenCalledWith(
        { voiceVolumes: { Friendly_Person: 2.5 } },
        { merge: true }
      );
    });

    // Voice IDs are not plain identifiers: many contain hyphens, spaces and
    // parentheses, and a charset-based check silently rejects ~14% of the catalogue.
    it.each([
      'English_Gentle-voiced_man',
      'Chinese (Mandarin)_News_Anchor',
    ])('should accept a volume for voice %s', async (voiceId) => {
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      await request(app)
        .put(`/api/tts/settings/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ key: `voiceVolumes.${voiceId}`, value: 2.5 })
        .expect(200);

      expect((db as any).set).toHaveBeenCalledWith(
        { voiceVolumes: { [voiceId]: 2.5 } },
        { merge: true }
      );
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

    it('should store the resolved user ID, not the typed name (happy path)', async () => {
      mockGetUserByUsername.mockResolvedValueOnce({ id: '52343457', login: 'spammer', displayName: 'Spammer' });
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .post(`/api/tts/ignore/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ username: 'Spammer' })
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'User added to ignore list',
        entry: { key: 'twitch:52343457', label: 'Spammer' },
      });
      expect(db.collection).toHaveBeenCalledWith('ttsChannelConfigs');
      expect(db.doc).toHaveBeenCalledWith(testUser.userId);
      // A nested map, not a dotted key: set() would otherwise create a literal
      // field named "ignoredUserIds.twitch:52343457".
      expect((db as any).set).toHaveBeenCalledWith(
        { ignoredUserIds: { 'twitch:52343457': 'Spammer' } },
        { merge: true }
      );
    });

    it('should strip a leading @ before resolving', async () => {
      mockGetUserByUsername.mockResolvedValueOnce({ id: '1', login: 'spammer', displayName: 'Spammer' });
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      await request(app)
        .post(`/api/tts/ignore/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ username: '@Spammer' })
        .expect(200);

      expect(mockGetUserByUsername).toHaveBeenCalledWith('spammer', expect.anything());
    });

    it('should reject a name that resolves to no Twitch account', async () => {
      // Storing it anyway would leave an entry in the list that can never match.
      mockGetUserByUsername.mockResolvedValueOnce(null);

      await request(app)
        .post(`/api/tts/ignore/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ username: 'nosuchaccount' })
        .expect(404);

      expect((db as any).set).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/tts/ignore/channel/:channelName', () => {
    it('should return 401 without authentication', async () => {
      await request(app)
        .delete(`/api/tts/ignore/channel/${channelName}`)
        .send({ key: 'twitch:52343457' })
        .expect(401);
    });

    it('should delete the entry by key via a FieldPath', async () => {
      ((db as any).update as any).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .delete(`/api/tts/ignore/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ key: 'twitch:52343457' })
        .expect(200);

      expect(response.body).toEqual({ success: true, message: 'User removed from ignore list' });
      expect(db.collection).toHaveBeenCalledWith('ttsChannelConfigs');
      expect(db.doc).toHaveBeenCalledWith(testUser.userId);

      // The colon in the key is why this must not be a dotted string path.
      const [path, sentinel] = ((db as any).update as any).mock.calls[0];
      expect(path.segments).toEqual(['ignoredUserIds', 'twitch:52343457']);
      expect(sentinel).toEqual({ type: 'delete' });
    });

    it('should require a key', async () => {
      await request(app)
        .delete(`/api/tts/ignore/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ username: 'Spammer' })
        .expect(400);
    });

    it('should report success when the entry is already gone', async () => {
      // NOT_FOUND means the desired end state already holds.
      ((db as any).update as any).mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 5 }));

      await request(app)
        .delete(`/api/tts/ignore/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ key: 'twitch:nobody' })
        .expect(200);
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

  describe('PUT /api/tts/settings/channel/:channelName (new toggles)', () => {
    it.each(['profanityFilterEnabled', 'pronunciationEnabled'])(
      'should accept a boolean for %s',
      async (key) => {
        ((db as any).set as any).mockResolvedValueOnce({} as any);

        await request(app)
          .put(`/api/tts/settings/channel/${channelName}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ key, value: true })
          .expect(200);

        expect((db as any).set).toHaveBeenCalledWith({ [key]: true }, { merge: true });
      }
    );

    it.each(['profanityFilterEnabled', 'pronunciationEnabled'])(
      'should reject a non-boolean for %s',
      async (key) => {
        await request(app)
          .put(`/api/tts/settings/channel/${channelName}`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ key, value: 'yes' })
          .expect(400);
      }
    );
  });

  describe('POST /api/tts/pronunciations/channel/:channelName', () => {
    /** The read-before-write that enforces the entry cap. */
    const mockExisting = (pronunciations: Record<string, string> | null) => {
      ((db as any).get as any).mockResolvedValueOnce({
        exists: pronunciations !== null,
        data: () => ({ pronunciations }),
      } as any);
    };

    it('should return 401 without authentication', async () => {
      await request(app)
        .post(`/api/tts/pronunciations/channel/${channelName}`)
        .send({ match: 'lfg', say: 'lets go' })
        .expect(401);
    });

    it('should return 403 for a different channel', async () => {
      await request(app)
        .post('/api/tts/pronunciations/channel/someoneelse')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: 'lfg', say: 'lets go' })
        .expect(403);
    });

    it('should store the entry as a nested map (happy path)', async () => {
      mockExisting({});
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .post(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: '  LFG  ', say: '  lets   go  ' })
        .expect(200);

      expect(response.body).toMatchObject({ success: true, match: 'lfg', say: 'lets go' });
      expect((db as any).set).toHaveBeenCalledWith(
        { pronunciations: { lfg: 'lets go' } },
        { merge: true }
      );
    });

    it('should reject a match containing a dot', async () => {
      // Firestore splits field paths on ".", so such a key would write to the
      // wrong nesting.
      await request(app)
        .post(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: 'a.b', say: 'ay bee' })
        .expect(400);
    });

    it('should reject the Firestore reserved prefix', async () => {
      await request(app)
        .post(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: '__proto', say: 'proto' })
        .expect(400);
    });

    it('should reject a missing match', async () => {
      await request(app)
        .post(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ say: 'lets go' })
        .expect(400);
    });

    it('should reject an empty say', async () => {
      // An empty value would let a message reduce to "", which the bot drops
      // instead of speaking.
      await request(app)
        .post(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: 'lfg', say: '   ' })
        .expect(400);
    });

    it('should reject an over-length match', async () => {
      await request(app)
        .post(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: 'x'.repeat(41), say: 'ex' })
        .expect(400);
    });

    it('should reject an over-length say', async () => {
      await request(app)
        .post(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: 'lfg', say: 'x'.repeat(121) })
        .expect(400);
    });

    it('should reject a say containing a link', async () => {
      await request(app)
        .post(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: 'site', say: 'go to example.com' })
        .expect(400);
    });

    it('should reject a new entry once the cap is reached', async () => {
      const full: Record<string, string> = {};
      for (let i = 0; i < 100; i++) full[`word${i}`] = 'thing';
      mockExisting(full);

      await request(app)
        .post(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: 'brandnew', say: 'brand new' })
        .expect(400);

      expect((db as any).set).not.toHaveBeenCalled();
    });

    it('should still allow updating an existing entry at the cap', async () => {
      const full: Record<string, string> = {};
      for (let i = 0; i < 100; i++) full[`word${i}`] = 'thing';
      mockExisting(full);
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      await request(app)
        .post(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: 'word5', say: 'updated' })
        .expect(200);

      expect((db as any).set).toHaveBeenCalledWith(
        { pronunciations: { word5: 'updated' } },
        { merge: true }
      );
    });

    it('should not let "constructor" slip past the cap', async () => {
      // It is a legal match key and an Object.prototype member, so an `in`
      // check would report it as already present and skip the cap.
      const full: Record<string, string> = {};
      for (let i = 0; i < 100; i++) full[`word${i}`] = 'thing';
      mockExisting(full);

      await request(app)
        .post(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: 'constructor', say: 'con struct or' })
        .expect(400);

      expect((db as any).set).not.toHaveBeenCalled();
    });

    it('should accept "constructor" as an ordinary entry under the cap', async () => {
      mockExisting({});
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      await request(app)
        .post(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: 'constructor', say: 'con struct or' })
        .expect(200);

      expect((db as any).set).toHaveBeenCalledWith(
        { pronunciations: { constructor: 'con struct or' } },
        { merge: true }
      );
    });

    it('should handle a channel with no pronunciations field yet', async () => {
      mockExisting(null);
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      await request(app)
        .post(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: 'lfg', say: 'lets go' })
        .expect(200);
    });
  });

  describe('DELETE /api/tts/pronunciations/channel/:channelName', () => {
    it('should return 401 without authentication', async () => {
      await request(app)
        .delete(`/api/tts/pronunciations/channel/${channelName}`)
        .send({ match: 'lfg' })
        .expect(401);
    });

    it('should delete via a FieldPath, not a dotted string', async () => {
      ((db as any).update as any).mockResolvedValueOnce({} as any);

      await request(app)
        .delete(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: ' LFG ' })
        .expect(200);

      const [path, sentinel] = ((db as any).update as any).mock.calls[0];
      expect(path.segments).toEqual(['pronunciations', 'lfg']);
      expect(sentinel).toEqual({ type: 'delete' });
    });

    it('should handle a key containing a space or hyphen', async () => {
      ((db as any).update as any).mockResolvedValueOnce({} as any);

      await request(app)
        .delete(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: 'e-girl gamer' })
        .expect(200);

      const [path] = ((db as any).update as any).mock.calls[0];
      expect(path.segments).toEqual(['pronunciations', 'e-girl gamer']);
    });

    it('should reject a missing match', async () => {
      await request(app)
        .delete(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({})
        .expect(400);
    });

    it('should report success when the entry is already gone', async () => {
      // NOT_FOUND means the desired end state already holds.
      const notFound: any = new Error('NOT_FOUND');
      notFound.code = 5;
      ((db as any).update as any).mockRejectedValueOnce(notFound);

      const response = await request(app)
        .delete(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: 'nothinghere' })
        .expect(200);

      expect(response.body).toEqual({ success: true, message: 'Pronunciation removed' });
    });

    it('should return 500 on an unexpected Firestore error', async () => {
      ((db as any).update as any).mockRejectedValueOnce(new Error('boom'));

      await request(app)
        .delete(`/api/tts/pronunciations/channel/${channelName}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ match: 'lfg' })
        .expect(500);
    });
  });
});
