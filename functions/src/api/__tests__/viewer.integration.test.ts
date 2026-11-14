/**
 * Integration tests for viewer API endpoints
 */

import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
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

describe('Viewer API Integration Tests', () => {
  let app: any;
  let db: any;
  const testUser = createTestUser('testviewer');
  const testChannel = 'testchannel';
  const testChannelId = '123456789';

  beforeAll(async () => {
    app = await createTestApp();
    db = getTestDb();
  });

  beforeEach(async () => {
    await clearTestData();
    loadLegacyVoiceMap([legacyMapFile]);
  });

  describe('POST /api/viewer/auth', () => {
    it('is gone, so an invite token grants nothing', async () => {
      // The endpoint validated nothing and returned no session, but the page
      // revealed the preferences panel on its 200 anyway. Both are removed;
      // viewers authenticate through Twitch like everyone else.
      await request(app)
        .post('/api/viewer/auth')
        .send({ token: 'any-token-at-all' })
        .expect(404);
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
      // Channel config must exist for the route to proceed
      await db.collection("managedChannels").doc(testChannelId).set({ channelName: testChannel, twitchUserId: testChannelId });
      await db.collection("ttsChannelConfigs").doc(testChannelId).set({
        voiceId: 'puck',
        speed: 1.2,
      });

      await db.collection('ttsUserPreferences').doc(testUser.userId).set({
        speed: 1.0,
        pitch: 0,
        emotion: 'neutral',
      });

      const token = createTestToken(testUser);
      const response = await request(app)
        .get(`/api/viewer/preferences/${testChannel}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Route returns a flat object with preferences fields + channelPolicy
      expect(response.body.channelExists).toBe(true);
      expect(response.body.channelPolicy).toBeDefined();
    });

    it('should return empty preferences when none exist', async () => {
      // Channel config must exist
      await db.collection("managedChannels").doc(testChannelId).set({ channelName: testChannel, twitchUserId: testChannelId });
      await db.collection("ttsChannelConfigs").doc(testChannelId).set({
        voiceId: 'puck',
      });

      const token = createTestToken(testUser);
      const response = await request(app)
        .get(`/api/viewer/preferences/${testChannel}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.channelExists).toBe(true);
    });

    it('should return the style of the viewer and of the channel, and no englishNormalization', async () => {
      await db.collection("managedChannels").doc(testChannelId).set({ channelName: testChannel, twitchUserId: testChannelId });
      await db.collection("ttsChannelConfigs").doc(testChannelId).set({
        voiceId: 'puck',
        style: 'like a newsreader',
        disabledSoundTags: ['laugh'],
        englishNormalization: true,
      });
      await db.collection('ttsUserPreferences').doc(testUser.userId).set({
        style: 'like a tired pirate',
        englishNormalization: true,
      });

      const response = await request(app)
        .get(`/api/viewer/preferences/${testChannel}`)
        .set('Authorization', `Bearer ${createTestToken(testUser)}`)
        .expect(200);

      expect(response.body.style).toBe('like a tired pirate');
      expect(response.body.channelDefaults.style).toBe('like a newsreader');
      expect(response.body.channelDefaults.disabledSoundTags).toEqual(['laugh']);
      expect(response.body).not.toHaveProperty('englishNormalization');
      expect(response.body.channelDefaults).not.toHaveProperty('englishNormalization');
    });

    it('should return a null style and no disabled sound tags when none are stored', async () => {
      await db.collection("managedChannels").doc(testChannelId).set({ channelName: testChannel, twitchUserId: testChannelId });
      await db.collection("ttsChannelConfigs").doc(testChannelId).set({ voiceId: 'puck' });

      const response = await request(app)
        .get(`/api/viewer/preferences/${testChannel}`)
        .set('Authorization', `Bearer ${createTestToken(testUser)}`)
        .expect(200);

      expect(response.body.style).toBeNull();
      expect(response.body.channelDefaults.style).toBeNull();
      expect(response.body.channelDefaults.disabledSoundTags).toEqual([]);
    });

    it('should return channel policy when allowViewerPreferences is false', async () => {
      await db.collection("managedChannels").doc(testChannelId).set({ channelName: testChannel, twitchUserId: testChannelId });
      await db.collection("ttsChannelConfigs").doc(testChannelId).set({
        allowViewerPreferences: false,
      });

      const token = createTestToken(testUser);
      const response = await request(app)
        .get(`/api/viewer/preferences/${testChannel}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.channelPolicy).toBeDefined();
      expect(response.body.channelPolicy.allowViewerPreferences).toBe(false);
    });
  });

  describe('PUT /api/viewer/preferences/:channel', () => {
    it('should return 401 without token', async () => {
      const response = await request(app)
        .put(`/api/viewer/preferences/${testChannel}`)
        .send({ speed: 1.0 })
        .expect(401);

      expect(response.body.success).toBe(false);
    });

    it('should update preferences with valid data', async () => {
      // Channel config must exist for the route to proceed
      await db.collection("managedChannels").doc(testChannelId).set({ channelName: testChannel, twitchUserId: testChannelId });
      await db.collection("ttsChannelConfigs").doc(testChannelId).set({
        voiceId: 'puck',
      });

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

      // Verify preferences were saved (using userId as doc key)
      const doc = await db.collection('ttsUserPreferences').doc(testUser.userId).get();
      const data = doc.data();
      expect(data.speed).toBe(1.2);
      expect(data.pitch).toBe(5);
    });

    it('should return 400 for invalid speed', async () => {
      await db.collection("managedChannels").doc(testChannelId).set({ channelName: testChannel, twitchUserId: testChannelId });
      await db.collection("ttsChannelConfigs").doc(testChannelId).set({
        voiceId: 'puck',
      });

      const token = createTestToken(testUser);
      const response = await request(app)
        .put(`/api/viewer/preferences/${testChannel}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ speed: 5.0 }) // Invalid: too high
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('should return 400 for invalid pitch', async () => {
      await db.collection("managedChannels").doc(testChannelId).set({ channelName: testChannel, twitchUserId: testChannelId });
      await db.collection("ttsChannelConfigs").doc(testChannelId).set({
        voiceId: 'puck',
      });

      const token = createTestToken(testUser);
      const response = await request(app)
        .put(`/api/viewer/preferences/${testChannel}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ pitch: 50 }) // Invalid: too high
        .expect(400);

      expect(response.body.error).toBeDefined();
    });
  });

  describe('PUT /api/viewer/preferences (voice, style and emotion)', () => {
    const prefs = () => db.collection('ttsUserPreferences').doc(testUser.userId);
    // Every write sets updatedAt, which tells the bot to read the document again.
    // The helper makes sure that it is there and compares the other fields.
    const stored = async () => {
      const { updatedAt, ...rest } = (await prefs().get()).data();
      expect(updatedAt).toBeDefined();
      return rest;
    };
    const put = (body: object) => request(app)
      .put('/api/viewer/preferences')
      .set('Authorization', `Bearer ${createTestToken(testUser)}`)
      .send(body);

    it('should store a Gemini voice in its catalog spelling and remove voiceStyle', async () => {
      await prefs().set({ voiceId: 'Friendly_Person', voiceStyle: 'warm and friendly', pitch: 2 });

      await put({ voiceId: 'Kore' }).expect(200);

      expect(await stored()).toEqual({ voiceId: 'kore', pitch: 2 });
    });

    it('should accept a MiniMax voice of the mapping', async () => {
      await put({ voiceId: 'Friendly_Person' }).expect(200);

      expect((await prefs().get()).data().voiceId).toBe('Friendly_Person');
    });

    it('should reject a MiniMax voice when the mapping is missing', async () => {
      loadLegacyVoiceMap([join(tmpdir(), 'no-such-voice-map.json')]);

      const response = await put({ voiceId: 'Friendly_Person' }).expect(400);

      expect(response.body.code).toBe('prefs_invalid_voice');
    });

    it('should reject an unknown voice', async () => {
      const response = await put({ voiceId: 'Not_A_Real_Voice' }).expect(400);

      expect(response.body.code).toBe('prefs_invalid_voice');
      expect((await prefs().get()).exists).toBe(false);
    });

    it('should remove voiceStyle when the voice is cleared', async () => {
      await prefs().set({ voiceId: 'Friendly_Person', voiceStyle: 'warm and friendly' });

      await put({ voiceId: null }).expect(200);

      expect(await stored()).toEqual({ voiceId: null });
    });

    it('should store a clean style and remove the emotion of an old record', async () => {
      await prefs().set({ emotion: 'happy' });

      await put({ style: '  like a <tired>\n pirate ' }).expect(200);

      expect(await stored()).toEqual({ style: 'like a tired pirate' });
    });

    it.each([[''], [null]])('should remove the style and the emotion for %p', async (style) => {
      await prefs().set({ style: 'like a tired pirate', emotion: 'happy', pitch: 2 });

      await put({ style }).expect(200);

      expect(await stored()).toEqual({ pitch: 2 });
    });

    it('should reject a style that is too long', async () => {
      const response = await put({ style: 'a'.repeat(121) }).expect(400);

      expect(response.body).toMatchObject({ success: false, code: 'style_too_long', params: { max: 120 } });
      expect((await prefs().get()).exists).toBe(false);
    });

    it('should reject a style that is not a string', async () => {
      const response = await put({ style: 5 }).expect(400);

      expect(response.body.code).toBe('prefs_invalid_style');
    });

    // The emotion is a setting of the old provider. A cached page can still send one.
    it('should write an emotion as its style words', async () => {
      await prefs().set({ style: 'like a tired pirate', emotion: 'happy' });

      await put({ emotion: 'sad' }).expect(200);

      expect(await stored()).toEqual({ style: 'sad and downcast' });
    });

    it('should keep the style words of an emotion that an old page sends with a null style', async () => {
      await put({ emotion: 'sad', style: null }).expect(200);

      expect(await stored()).toEqual({ style: 'sad and downcast' });
    });

    // A viewer with no style gets the style of the channel, so neutral needs words.
    it('should write the emotion neutral as the neutral style', async () => {
      await put({ emotion: 'neutral' }).expect(200);

      expect(await stored()).toEqual({ style: 'in a neutral tone' });
    });

    // "auto" was the word for "use the channel default".
    it('should remove the style and the emotion for the emotion auto', async () => {
      await prefs().set({ style: 'like a tired pirate', emotion: 'happy', pitch: 2 });

      await put({ emotion: 'auto' }).expect(200);

      expect(await stored()).toEqual({ pitch: 2 });
    });

    it('should remove the style and the emotion for a null emotion', async () => {
      await prefs().set({ style: 'like a tired pirate', emotion: 'happy', pitch: 2 });

      await put({ emotion: null }).expect(200);

      expect(await stored()).toEqual({ pitch: 2 });
    });

    it('should keep a style sent together with an emotion', async () => {
      await put({ emotion: 'sad', style: 'like a tired pirate' }).expect(200);

      expect(await stored()).toEqual({ style: 'like a tired pirate' });
    });

    it('should ignore englishNormalization from an old client', async () => {
      await put({ englishNormalization: true, pitch: 3 }).expect(200);

      expect(await stored()).toEqual({ pitch: 3 });
    });

    it('should return the style from GET /api/viewer/preferences', async () => {
      await prefs().set({ style: 'like a tired pirate', englishNormalization: true });

      const response = await request(app)
        .get('/api/viewer/preferences')
        .set('Authorization', `Bearer ${createTestToken(testUser)}`)
        .expect(200);

      expect(response.body.style).toBe('like a tired pirate');
      expect(response.body).not.toHaveProperty('englishNormalization');
    });
  });
});
