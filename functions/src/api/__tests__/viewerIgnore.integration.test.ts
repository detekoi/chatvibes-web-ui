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
  });
});
