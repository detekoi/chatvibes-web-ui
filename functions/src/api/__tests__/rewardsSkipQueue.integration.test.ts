/**
 * The TTS reward never skips Twitch's request queue.
 *
 * A redemption that skips the queue is FULFILLED at once, and Twitch refunds
 * only an UNFULFILLED one, so the bot could never refund a message it refused.
 * The bot now approves or cancels each redemption itself. The dashboard toggle
 * "Skip the Reward Queue" is stored as `channelPoints.skipQueue` and tells the
 * bot whether to approve at once; it no longer reaches Twitch.
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
    COLLECTIONS: { TTS_CHANNEL_CONFIGS: 'ttsChannelConfigs', MANAGED_CHANNELS: 'managedChannels' },
    FieldValue: { delete: jest.fn() },
  };
});

jest.mock('../../services/twitch', () => ({
  getValidTwitchTokenForUser: jest.fn(async () => 'user-token'),
}));

const helix = { get: jest.fn<any>(), post: jest.fn<any>(), patch: jest.fn<any>() };
jest.mock('axios', () => {
  const actual = jest.requireActual('axios') as any;
  return { ...actual, __esModule: true, default: { ...actual.default, create: () => helix } };
});

import request from 'supertest';
import { createTestApp } from './appHelper';
import { createTestToken } from './testHelpers';
import { db } from '../../services/firestore';

describe('TTS reward and the request queue (Mocked Firestore and Helix)', () => {
  let app: any;
  let authToken: string;
  const broadcaster = { userId: '111', userLogin: 'streamer', displayName: 'Streamer' };

  const storedConfig = (channelPoints: Record<string, unknown>) =>
    ((db as any).get as any).mockResolvedValue({ exists: true, data: () => ({ channelPoints }) });

  beforeAll(async () => {
    app = await createTestApp();
    authToken = createTestToken(broadcaster);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ((db as any).collection as any).mockReturnValue(db);
    ((db as any).doc as any).mockReturnValue(db);
    ((db as any).set as any).mockResolvedValue({});
    helix.patch.mockResolvedValue({ data: {} });
  });

  it.each([true, false])('keeps Twitch skip-queue off when the toggle is %p, and stores the toggle', async (skipQueue) => {
    storedConfig({ rewardId: 'reward-1', enabled: true });

    await request(app)
      .put('/api/rewards/tts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ enabled: true, skipQueue })
      .expect(200);

    const [, body] = helix.patch.mock.calls[0] as [string, Record<string, unknown>];
    expect(body.should_redemptions_skip_request_queue).toBe(false);
    const stored = ((db as any).set as any).mock.calls.at(-1)[0];
    expect(stored.channelPoints.skipQueue).toBe(skipQueue);
  });

  it('creates a new reward with skip-queue off, and approval on for the bot', async () => {
    ((db as any).get as any).mockResolvedValue({ exists: true, data: () => ({}) });
    helix.get.mockResolvedValue({ data: { data: [] } });
    helix.post.mockResolvedValue({ data: { data: [{ id: 'new-reward' }] } });

    await request(app)
      .put('/api/rewards/tts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ enabled: true })
      .expect(200);

    const [, created] = helix.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(created.should_redemptions_skip_request_queue).toBe(false);
    const firstWrite = ((db as any).set as any).mock.calls[0][0];
    expect(firstWrite.channelPoints.skipQueue).toBe(true);
  });
});
