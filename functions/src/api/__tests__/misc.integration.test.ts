/**
 * Integration tests for miscellaneous API endpoints (shortlinks, TTS test)
 */

import {describe, it, expect, beforeAll, beforeEach, afterEach, jest} from '@jest/globals';
import request from 'supertest';
import {createTestApp} from './appHelper';
import {createTestToken, createTestUser, getTestDb, clearTestData} from './testHelpers';
import {loadLegacyVoiceMap} from '../../services/voices';
import {wavFromPcm} from '../../services/geminiTts';
import {mkdtempSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

// The synced MiniMax map is optional, so the tests bring their own.
const legacyMapFile = join(mkdtempSync(join(tmpdir(), 'voice-map-')), 'map.json');
writeFileSync(legacyMapFile, JSON.stringify({'Friendly_Person': {voice: 'kore', style: 'warm and friendly'}}));

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

  describe('GET /api/voices', () => {
    it('should return the Gemini catalog without authentication', async () => {
      const response = await request(app).get('/api/voices').expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.version).toMatch(/^[0-9a-f]{12}$/);
      expect(response.body.defaultVoiceId).toBe('puck');
      expect(response.body.voices.length).toBeGreaterThan(2000);
      expect(response.body.voices.find((voice: any) => voice.id === 'puck')).toEqual(expect.objectContaining({
        id: 'puck',
        name: 'Puck',
        studio: true,
        language: 'en-US',
        gender: 'male',
      }));
      expect(response.headers['cache-control']).toBe('public, max-age=3600');
    });

    it('should compress the body for a client that accepts gzip', async () => {
      const gzip = await request(app).get('/api/voices').set('Accept-Encoding', 'gzip').expect(200);
      expect(gzip.headers['content-encoding']).toBe('gzip');
      expect(gzip.headers['vary']).toContain('Accept-Encoding');
      // supertest decompresses, so the body is still the catalog.
      expect(gzip.body.voices.length).toBeGreaterThan(2000);

      const plain = await request(app).get('/api/voices').set('Accept-Encoding', 'identity').expect(200);
      expect(plain.headers['content-encoding']).toBeUndefined();
      expect(plain.body.version).toBe(gzip.body.version);
    });

    it('should answer 304 for the ETag it sent', async () => {
      const first = await request(app).get('/api/voices').expect(200);
      expect(first.headers['etag']).toBeDefined();

      await request(app).get('/api/voices').set('If-None-Match', first.headers['etag']).expect(304);
    });
  });

  describe('POST /api/tts/test', () => {
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/interactions';
    let fetchMock: any;
    const realFetch = global.fetch;

    // Four 16-bit samples behind a 44-byte WAV header.
    const samples = [1000, -1000, 20000, -20000];
    const wav = () => {
      const pcm = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, i) => pcm.writeInt16LE(sample, i * 2));
      return wavFromPcm(pcm);
    };
    const audioResponse = (data: Buffer = wav(), mimeType = 'audio/wav') => new Response(JSON.stringify({
      id: 'interaction-1',
      steps: [{ type: 'model_output', content: [{ type: 'audio', data: data.toString('base64'), mime_type: mimeType }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const readSamples = (audioBase64: string) => {
      const out = Buffer.from(audioBase64, 'base64');
      return samples.map((_sample, i) => out.readInt16LE(44 + i * 2));
    };
    const post = (body: object) => request(app)
        .post('/api/tts/test')
        .set('Authorization', `Bearer ${createTestToken(testUser)}`)
        .send(body);
    const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

    // Loaded late: createTestApp sets the environment that the config reads.
    let secrets: any;

    beforeEach(() => {
      secrets = require('../../config').secrets;
      secrets.GEMINI_API_KEY = 'test-gemini-key';
      delete process.env.GEMINI_TTS_MODEL;
      loadLegacyVoiceMap([legacyMapFile]);
      fetchMock = jest.fn<any>().mockImplementation(async () => audioResponse());
      global.fetch = fetchMock;
    });

    afterEach(() => {
      global.fetch = realFetch;
    });

    it('should return 401 without token', async () => {
      const response = await request(app)
          .post('/api/tts/test')
          .send({text: 'Hello world'})
          .expect(401);

      expect(response.body.success).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return 400 when text is missing', async () => {
      const response = await post({}).expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Text is required');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should return 501 when the Gemini key is not configured', async () => {
      secrets.GEMINI_API_KEY = '';

      const response = await post({text: 'Hello world'}).expect(501);

      expect(response.body).toMatchObject({ success: false, code: 'tts_not_configured' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should make one Gemini request and return the WAV as base64', async () => {
      const response = await post({text: 'Hello world', voiceId: 'kore'}).expect(200);

      expect(response.body).toEqual({
        success: true,
        audioBase64: wav().toString('base64'),
        mimeType: 'audio/wav',
        provider: 'gemini',
        model: 'gemini-3.8-flash-lite-tts',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(endpoint);
      expect(init.method).toBe('POST');
      expect(init.headers['x-goog-api-key']).toBe('test-gemini-key');
      expect(sentBody()).toEqual({
        model: 'gemini-3.8-flash-lite-tts',
        input: [{ type: 'user_input', content: [{ type: 'text', text: 'Hello world' }] }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: 'kore' }] },
        store: false,
      });
    });

    it('should use the default voice when none is given or stored', async () => {
      await post({text: 'Hello world'}).expect(200);

      expect(sentBody().generation_config.speech_config).toEqual([{ voice: 'puck' }]);
    });

    it('should send the style built from emotion, speed and pitch, and the language hint', async () => {
      await post({
        text: 'Hello world', voiceId: 'kore', emotion: 'happy', speed: 1.5, pitch: -5, languageBoost: 'Japanese',
      }).expect(200);

      expect(sentBody().input[0].content[0].annotations).toEqual([
        { type: 'speech_metadata', style: 'happy and cheerful, speaking quickly, low pitch' },
      ]);
      expect(sentBody().generation_config.speech_config).toEqual([{ voice: 'kore', language: 'ja' }]);
    });

    it('should let a custom style replace the emotion', async () => {
      await post({text: 'Hello world', emotion: 'happy', style: 'like a tired pirate'}).expect(200);

      expect(sentBody().input[0].content[0].annotations[0].style).toBe('like a tired pirate');
    });

    it.each(['auto', 'Automatic', 'None'])('should send no language hint for %s', async (languageBoost) => {
      await post({text: 'Hello world', languageBoost}).expect(200);

      expect(sentBody().generation_config.speech_config).toEqual([{ voice: 'puck' }]);
    });

    it('should map a MiniMax voice to its Gemini voice and manner', async () => {
      await post({text: 'Hello world', voiceId: 'Friendly_Person'}).expect(200);

      expect(sentBody().generation_config.speech_config).toEqual([{ voice: 'kore' }]);
      expect(sentBody().input[0].content[0].annotations[0].style).toBe('warm and friendly');
    });

    it('should fall back to the stored preferences of the viewer', async () => {
      await db.collection('ttsUserPreferences').doc(testUser.userId).set({
        voiceId: 'zephyr', voiceStyle: 'in a soft voice', style: 'like a tired pirate', emotion: 'sad', speed: 0.5, languageBoost: 'French',
      });

      await post({text: 'Hello world'}).expect(200);

      expect(sentBody().generation_config.speech_config).toEqual([{ voice: 'zephyr', language: 'fr' }]);
      expect(sentBody().input[0].content[0].annotations[0].style)
          .toBe('in a soft voice, like a tired pirate, speaking very slowly');
    });

    it('should not carry the stored style or voice manner over to a requested emotion or voice', async () => {
      await db.collection('ttsUserPreferences').doc(testUser.userId).set({
        voiceId: 'zephyr', voiceStyle: 'in a soft voice', style: 'like a tired pirate',
      });

      await post({text: 'Hello world', voiceId: 'kore', emotion: 'angry'}).expect(200);

      expect(sentBody().generation_config.speech_config).toEqual([{ voice: 'kore' }]);
      expect(sentBody().input[0].content[0].annotations[0].style).toBe('angry');
    });

    it('should apply the volume to the samples and clip at full scale', async () => {
      const response = await post({text: 'Hello world', volume: 2}).expect(200);

      expect(readSamples(response.body.audioBase64)).toEqual([2000, -2000, 32767, -32768]);
      // The header is not audio and stays as it was.
      expect(Buffer.from(response.body.audioBase64, 'base64').subarray(0, 44)).toEqual(wav().subarray(0, 44));
    });

    it('should wrap raw PCM in a WAV file at the rate of the type', async () => {
      fetchMock.mockImplementation(async () => audioResponse(wav().subarray(44), 'audio/L16;codec=pcm;rate=16000'));

      const response = await post({text: 'Hello world'}).expect(200);

      const out = Buffer.from(response.body.audioBase64, 'base64');
      expect(out.toString('latin1', 0, 4)).toBe('RIFF');
      expect(out.readUInt32LE(24)).toBe(16000);
      expect(readSamples(response.body.audioBase64)).toEqual(samples);
    });

    it('should use the model from GEMINI_TTS_MODEL', async () => {
      process.env.GEMINI_TTS_MODEL = 'gemini-test-tts';

      const response = await post({text: 'Hello world'}).expect(200);

      expect(response.body.model).toBe('gemini-test-tts');
      expect(sentBody().model).toBe('gemini-test-tts');
    });

    it.each([
      ['the prohibited_content code', { code: 'prohibited_content', message: 'Refused.' }],
      ['an "Input blocked" message', { code: 'invalid_request', message: 'Input blocked due to safety settings.' }],
    ])('should map a refusal with %s to 400 tts_blocked', async (_label, error) => {
      fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error }), { status: 400 }));

      const response = await post({text: 'Hello world'}).expect(400);

      expect(response.body).toMatchObject({ success: false, code: 'tts_blocked' });
    });

    it('should map another provider error to 502 and not pass on its message', async () => {
      fetchMock.mockImplementation(async () => new Response(
          JSON.stringify({ error: { code: 'internal', message: 'secret detail' } }), { status: 500 }));

      const response = await post({text: 'Hello world'}).expect(502);

      expect(response.body).toMatchObject({ success: false, code: 'tts_generation_failed', params: { reason: 'HTTP 500' } });
      expect(JSON.stringify(response.body)).not.toContain('secret detail');
    });

    it('should map a network failure to 502', async () => {
      fetchMock.mockImplementation(async () => {
        throw new TypeError('fetch failed');
      });

      const response = await post({text: 'Hello world'}).expect(502);

      expect(response.body).toMatchObject({ success: false, code: 'tts_generation_failed', params: { reason: 'network' } });
    });

    it('should map a response with no audio to 502 tts_no_audio', async () => {
      fetchMock.mockImplementation(async () => new Response(JSON.stringify({ steps: [] }), { status: 200 }));

      const response = await post({text: 'Hello world'}).expect(502);

      expect(response.body).toMatchObject({ success: false, code: 'tts_no_audio' });
    });
  });
});
