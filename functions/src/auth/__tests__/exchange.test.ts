/**
 * Tests for auth/exchange.ts and POST /auth/exchange.
 *
 * These run against the Firestore emulator rather than a stand-in, so the
 * transaction semantics that make a code single-use are actually exercised.
 *
 * The property that matters: a code stands in for the session token exactly
 * once, briefly, and the raw code is never what gets stored.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createHash } from 'crypto';
import { db } from '../../services/firestore';
import {
  createExchangeCode,
  redeemExchangeCode,
  EXCHANGE_CODES_COLLECTION,
} from '../exchange';
import authRoutes from '../routes';

jest.mock('axios');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRoutes);
  return app;
}

/**
 * Reads the stored row for a code, so tests can inspect or age it.
 * @param code - The raw exchange code
 * @return The Firestore document reference for that code
 */
function rowFor(code: string) {
  const id = createHash('sha256').update(code).digest('hex');
  return db!.collection(EXCHANGE_CODES_COLLECTION).doc(id);
}

describe('exchange codes', () => {
  beforeEach(() => {
    if (!db) throw new Error('Firestore emulator not available');
  });

  it('returns a high-entropy code', async () => {
    const code = await createExchangeCode(db!, 'the.session.jwt');

    expect(code).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stores only the hash of the code, never the code itself', async () => {
    const code = await createExchangeCode(db!, 'the.session.jwt');

    const snap = await rowFor(code).get();
    expect(snap.exists).toBe(true);
    expect(JSON.stringify(snap.data())).not.toContain(code);
  });

  it('redeems a fresh code for its session token', async () => {
    const code = await createExchangeCode(db!, 'the.session.jwt');

    const result = await redeemExchangeCode(db!, code);

    expect(result.ok).toBe(true);
    expect(result.ok && result.sessionToken).toBe('the.session.jwt');
  });

  it('refuses a code the second time, so it cannot be replayed', async () => {
    const code = await createExchangeCode(db!, 'the.session.jwt');

    await redeemExchangeCode(db!, code);
    const second = await redeemExchangeCode(db!, code);

    expect(second.ok).toBe(false);
    expect(!second.ok && second.reason).toBe('unknown_code');
  });

  it('deletes the row on redemption', async () => {
    const code = await createExchangeCode(db!, 'the.session.jwt');

    await redeemExchangeCode(db!, code);

    expect((await rowFor(code).get()).exists).toBe(false);
  });

  it('refuses an unknown code', async () => {
    const result = await redeemExchangeCode(db!, 'f'.repeat(64));

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('unknown_code');
  });

  it('enforces expiry itself rather than trusting the Firestore TTL sweep', async () => {
    const code = await createExchangeCode(db!, 'the.session.jwt');

    // A TTL policy deletes within ~24h of expiry, so a row can outlive its
    // expiresAt by a long way and must still be refused.
    await rowFor(code).update({ expiresAt: new Date(Date.now() - 23 * 60 * 60 * 1000) });

    const result = await redeemExchangeCode(db!, code);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('expired');
  });

  it('spends an expired code rather than leaving it redeemable', async () => {
    const code = await createExchangeCode(db!, 'the.session.jwt');
    await rowFor(code).update({ expiresAt: new Date(Date.now() - 1000) });

    await redeemExchangeCode(db!, code);

    expect((await rowFor(code).get()).exists).toBe(false);
  });

  it('lets only one of two concurrent redemptions win', async () => {
    const code = await createExchangeCode(db!, 'the.session.jwt');

    const [a, b] = await Promise.all([
      redeemExchangeCode(db!, code),
      redeemExchangeCode(db!, code),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });
});

describe('POST /auth/exchange', () => {
  it('rejects a request with no code', async () => {
    const res = await request(createApp()).post('/auth/exchange').send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('rejects a malformed code before touching the database', async () => {
    const res = await request(createApp()).post('/auth/exchange').send({ code: 'not-hex' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('malformed');
  });

  it('rejects an unknown code without leaking why', async () => {
    const res = await request(createApp())
      .post('/auth/exchange')
      .send({ code: 'f'.repeat(64) });

    expect(res.status).toBe(400);
    expect(res.body.session_token).toBeUndefined();
  });

  it('returns the session token for a valid code, once', async () => {
    const app = createApp();
    const code = await createExchangeCode(db!, 'the.session.jwt');

    const first = await request(app).post('/auth/exchange').send({ code });
    expect(first.status).toBe(200);
    expect(first.body.session_token).toBe('the.session.jwt');

    const second = await request(app).post('/auth/exchange').send({ code });
    expect(second.status).toBe(400);
    expect(second.body.session_token).toBeUndefined();
  });
});
