/**
 * Integration tests for the viewer TTS opt-out endpoint.
 *
 * This route used to be an unguarded toggle: it deleted whatever entry it found
 * under the caller's own key, so a viewer a moderator had muted for TTS abuse
 * could clear that mute with one authenticated request. The only thing standing
 * in the way was a disabled checkbox in the browser. These tests pin the rule
 * that replaced it — a viewer may lift their own opt-out and nothing else.
 */

import { describe, it, expect, beforeAll, beforeEach, jest } from '@jest/globals';

jest.mock('../../services/firestore', () => {
  const mockDbInstance: any = {
    collection: jest.fn(),
    doc: jest.fn(),
    where: jest.fn(),
    limit: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
  };
  mockDbInstance.collection.mockReturnValue(mockDbInstance);
  mockDbInstance.doc.mockReturnValue(mockDbInstance);
  mockDbInstance.where.mockReturnValue(mockDbInstance);
  mockDbInstance.limit.mockReturnValue(mockDbInstance);

  // Segments stay an array so assertions can inspect them; the real FieldPath
  // treats them literally, which is why the colon in the key is safe.
  class MockFieldPath {
    segments: string[];
    constructor(...segments: string[]) {
      this.segments = segments;
    }
  }

  return {
    db: mockDbInstance,
    COLLECTIONS: {
      MANAGED_CHANNELS: 'managedChannels',
      TTS_CHANNEL_CONFIGS: 'ttsChannelConfigs',
      TTS_USER_PREFS: 'ttsUserPreferences',
    },
    FieldValue: { delete: jest.fn(() => ({ type: 'delete' })) },
    FieldPath: MockFieldPath,
  };
});

const mockLoadGlobalUserPreferences = jest.fn<any>();
jest.mock('../../services/preferences', () => ({
  loadGlobalUserPreferences: mockLoadGlobalUserPreferences,
}));

import request from 'supertest';
import { createTestApp } from './appHelper';
import { createTestToken } from './testHelpers';
import { db, FieldValue } from '../../services/firestore';

describe('Viewer TTS opt-out (Mocked Firestore)', () => {
  let app: any;
  let authToken: string;
  const channelName = 'somechannel';
  const viewer = { userId: '4242', userLogin: 'viewer', displayName: 'Viewer' };
  const entryKey = `twitch:${viewer.userId}`;
  const endpoint = `/api/viewer/ignore/tts/${channelName}`;

  /** Queue the two reads the route makes: resolve the channel, then load its config. */
  const seed = (ignoredUserIds: Record<string, unknown>) => {
    ((db as any).get as any)
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ id: 'chan-1', data: () => ({ twitchUserId: 'chan-1' }) }],
      })
      .mockResolvedValueOnce({ exists: true, data: () => ({ ignoredUserIds }) });
  };

  beforeAll(async () => {
    app = await createTestApp();
    authToken = createTestToken(viewer);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ((db as any).collection as any).mockReturnValue(db);
    ((db as any).doc as any).mockReturnValue(db);
    ((db as any).where as any).mockReturnValue(db);
    ((db as any).limit as any).mockReturnValue(db);
    (FieldValue.delete as any).mockImplementation(() => ({ type: 'delete' }));
    mockLoadGlobalUserPreferences.mockResolvedValue({});
  });

  it('should return 401 without authentication', async () => {
    await request(app).post(endpoint).expect(401);
  });

  it('opts the viewer out, recorded as self-imposed so it stays reversible', async () => {
    seed({});
    ((db as any).set as any).mockResolvedValueOnce({} as any);

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toMatchObject({ success: true, ignored: true });
    const [payload, options] = ((db as any).set as any).mock.calls[0];
    expect(options).toEqual({ merge: true });
    expect(payload.ignoredUserIds[entryKey]).toMatchObject({
      label: viewer.userLogin,
      source: 'self',
      by: entryKey,
    });
  });

  it('writes every provenance field, so a merge cannot inherit a stale source', async () => {
    seed({});
    ((db as any).set as any).mockResolvedValueOnce({} as any);

    await request(app).post(endpoint).set('Authorization', `Bearer ${authToken}`).expect(200);

    const [payload] = ((db as any).set as any).mock.calls[0];
    const entry = payload.ignoredUserIds[entryKey];
    expect(Object.keys(entry).sort()).toEqual(['at', 'by', 'label', 'source']);
    expect(Date.parse(entry.at)).not.toBeNaN();
  });

  it('lets the viewer lift their own opt-out', async () => {
    seed({ [entryKey]: { label: 'Viewer', source: 'self', by: entryKey, at: 'then' } });
    ((db as any).update as any).mockResolvedValueOnce({} as any);

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body).toMatchObject({ success: true, ignored: false });
    // The colon in the key is why this must not be a dotted string path.
    const [path, sentinel] = ((db as any).update as any).mock.calls[0];
    expect(path.segments).toEqual(['ignoredUserIds', entryKey]);
    expect(sentinel).toEqual({ type: 'delete' });
  });

  it('refuses to lift a moderator-imposed mute, and writes nothing', async () => {
    // The regression this endpoint's guard exists to prevent.
    seed({ [entryKey]: { label: 'Viewer', source: 'moderator', by: 'twitch:99', at: 'then' } });

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(403);

    expect(response.body).toMatchObject({ reason: 'moderator_imposed', ignored: true });
    expect((db as any).update).not.toHaveBeenCalled();
    expect((db as any).set).not.toHaveBeenCalled();
  });

  it('refuses to lift a legacy entry, whose provenance is unknown', async () => {
    // A bare string predates provenance. Reading it as self-imposed would unlock
    // every mute placed before this change.
    seed({ [entryKey]: 'Viewer' });

    const response = await request(app)
      .post(endpoint)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(403);

    expect(response.body).toMatchObject({ reason: 'moderator_imposed' });
    expect((db as any).update).not.toHaveBeenCalled();
    expect((db as any).set).not.toHaveBeenCalled();
  });

  it('ignores an entry belonging to somebody else', async () => {
    // The key is derived from the token, never from the request, so a viewer can
    // only ever act on their own entry.
    seed({ 'twitch:9999': { label: 'Someone Else', source: 'self', by: 'twitch:9999' } });
    ((db as any).set as any).mockResolvedValueOnce({} as any);

    await request(app).post(endpoint).set('Authorization', `Bearer ${authToken}`).expect(200);

    const [payload] = ((db as any).set as any).mock.calls[0];
    expect(Object.keys(payload.ignoredUserIds)).toEqual([entryKey]);
  });

  // The page sends the state it wants, so a double click or a stale tab cannot
  // flip the viewer the wrong way. The toggle above is kept for cached pages.
  describe('with a wanted state in the body', () => {
    const selfEntry = { label: 'Viewer', source: 'self', by: entryKey, at: 'then' };
    const modEntry = { label: 'Viewer', source: 'moderator', by: 'twitch:99', at: 'then' };

    it('opts the viewer out when asked to', async () => {
      seed({});
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .post(endpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ignored: true })
        .expect(200);

      expect(response.body).toMatchObject({ success: true, ignored: true, source: 'self' });
      expect((db as any).set).toHaveBeenCalledTimes(1);
    });

    it('writes nothing when the viewer is already opted out', async () => {
      // The second request of a double click must not opt them back in.
      seed({ [entryKey]: selfEntry });

      const response = await request(app)
        .post(endpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ignored: true })
        .expect(200);

      expect(response.body).toMatchObject({ success: true, ignored: true });
      expect((db as any).set).not.toHaveBeenCalled();
      expect((db as any).update).not.toHaveBeenCalled();
    });

    it('reports a moderator mute as opted out, and writes nothing', async () => {
      seed({ [entryKey]: modEntry });

      const response = await request(app)
        .post(endpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ignored: true })
        .expect(200);

      expect(response.body).toMatchObject({ success: true, ignored: true, source: 'moderator' });
      expect((db as any).set).not.toHaveBeenCalled();
      expect((db as any).update).not.toHaveBeenCalled();
    });

    it('lifts a self opt-out when asked to', async () => {
      seed({ [entryKey]: selfEntry });
      ((db as any).update as any).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .post(endpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ignored: false })
        .expect(200);

      expect(response.body).toMatchObject({ success: true, ignored: false });
      const [path] = ((db as any).update as any).mock.calls[0];
      expect(path.segments).toEqual(['ignoredUserIds', entryKey]);
    });

    it('writes nothing when the viewer is already opted in', async () => {
      // A stale tab that still shows the switch on must not opt them out.
      seed({});

      const response = await request(app)
        .post(endpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ignored: false })
        .expect(200);

      expect(response.body).toMatchObject({ success: true, ignored: false });
      expect((db as any).set).not.toHaveBeenCalled();
      expect((db as any).update).not.toHaveBeenCalled();
    });

    it('still refuses to lift a moderator mute', async () => {
      seed({ [entryKey]: modEntry });

      const response = await request(app)
        .post(endpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ignored: false })
        .expect(403);

      expect(response.body).toMatchObject({ reason: 'moderator_imposed', ignored: true });
      expect((db as any).update).not.toHaveBeenCalled();
    });

    it.each(['yes', 1, null])('refuses ignored=%p and reads nothing', async (ignored) => {
      const response = await request(app)
        .post(endpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ ignored })
        .expect(400);

      expect(response.body.code).toBe('invalid_opt_out');
      expect((db as any).get).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/viewer/preferences/:channel', () => {
    const prefsEndpoint = `/api/viewer/preferences/${channelName}`;

    it('reports a self opt-out as reversible', async () => {
      seed({ [entryKey]: { label: 'Viewer', source: 'self', by: entryKey, at: 'then' } });

      const response = await request(app)
        .get(prefsEndpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.ignoreStatus).toEqual({
        tts: true, ttsSource: 'self', ttsCanSelfUndo: true,
      });
    });

    it('reports a moderator mute as not reversible', async () => {
      seed({ [entryKey]: { label: 'Viewer', source: 'moderator', by: 'twitch:99', at: 'then' } });

      const response = await request(app)
        .get(prefsEndpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.ignoreStatus).toEqual({
        tts: true, ttsSource: 'moderator', ttsCanSelfUndo: false,
      });
    });

    it('reports a viewer who is not on the list at all', async () => {
      seed({});

      const response = await request(app)
        .get(prefsEndpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.ignoreStatus).toEqual({
        tts: false, ttsSource: null, ttsCanSelfUndo: false,
      });
    });

    it('reports the opt-out as unknown when the preferences read fails', async () => {
      seed({});
      mockLoadGlobalUserPreferences.mockRejectedValueOnce(new Error('unavailable'));

      const response = await request(app)
        .get(prefsEndpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.globalOptOut).toBeNull();
    });

    it('reports the opt-out from every channel', async () => {
      seed({});
      mockLoadGlobalUserPreferences.mockResolvedValueOnce({ globalOptOut: true, globalOptOutAt: 'then' });

      const response = await request(app)
        .get(prefsEndpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.globalOptOut).toBe(true);
    });
  });

  describe('GET /api/viewer/preferences', () => {
    it('reports the opt-out as unknown when the preferences read fails', async () => {
      mockLoadGlobalUserPreferences.mockRejectedValueOnce(new Error('unavailable'));

      const response = await request(app)
        .get('/api/viewer/preferences')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.globalOptOut).toBeNull();
    });

    it('reports the opt-out from every channel', async () => {
      mockLoadGlobalUserPreferences.mockResolvedValueOnce({ globalOptOut: true });

      const response = await request(app)
        .get('/api/viewer/preferences')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.globalOptOut).toBe(true);
    });

    it('reports false when the flag is absent', async () => {
      const response = await request(app)
        .get('/api/viewer/preferences')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.globalOptOut).toBe(false);
    });
  });

  // The opt-out from every channel lives on the viewer's own preferences
  // document. It takes the state to set rather than toggling, so a retried
  // request cannot undo itself.
  describe('PUT /api/viewer/opt-out', () => {
    const optOutEndpoint = '/api/viewer/opt-out';

    it('should return 401 without authentication', async () => {
      await request(app).put(optOutEndpoint).send({ optedOut: true }).expect(401);
    });

    it('opts the viewer out on their own preferences document', async () => {
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .put(optOutEndpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ optedOut: true })
        .expect(200);

      expect(response.body).toEqual({ success: true, globalOptOut: true });
      expect((db as any).collection).toHaveBeenCalledWith('ttsUserPreferences');
      expect((db as any).doc).toHaveBeenCalledWith(viewer.userId);
      const [payload, options] = ((db as any).set as any).mock.calls[0];
      expect(options).toEqual({ merge: true });
      expect(payload.globalOptOut).toBe(true);
      expect(Date.parse(payload.globalOptOutAt)).not.toBeNaN();
    });

    it('opts the viewer back in by deleting both fields', async () => {
      ((db as any).set as any).mockResolvedValueOnce({} as any);

      const response = await request(app)
        .put(optOutEndpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ optedOut: false })
        .expect(200);

      expect(response.body).toEqual({ success: true, globalOptOut: false });
      const [payload, options] = ((db as any).set as any).mock.calls[0];
      expect(options).toEqual({ merge: true });
      expect(payload).toEqual({ globalOptOut: { type: 'delete' }, globalOptOutAt: { type: 'delete' } });
    });

    it.each([undefined, 'true', 1, null])('refuses optedOut=%p and writes nothing', async (optedOut) => {
      const response = await request(app)
        .put(optOutEndpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ optedOut })
        .expect(400);

      expect(response.body.code).toBe('invalid_opt_out');
      expect((db as any).set).not.toHaveBeenCalled();
    });

    it('reports a failed write', async () => {
      ((db as any).set as any).mockRejectedValueOnce(new Error('unavailable'));

      const response = await request(app)
        .put(optOutEndpoint)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ optedOut: true })
        .expect(500);

      expect(response.body.code).toBe('opt_out_update_failed');
    });
  });
});
