/**
 * Test helpers for API integration tests
 */

import * as jwt from 'jsonwebtoken';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin for emulator
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'test-project',
  });
}

const TEST_JWT_SECRET = 'test-jwt-secret-key-for-integration-tests';

/**
 * Create a JWT token for testing authenticated requests
 */
export function createTestToken(payload: {
  userId: string;
  userLogin: string;
  displayName?: string;
  scope?: string;
}): string {
  return jwt.sign(
    {
      userId: payload.userId,
      userLogin: payload.userLogin,
      displayName: payload.displayName || payload.userLogin,
      scope: payload.scope || 'viewer',
    },
    TEST_JWT_SECRET,
    {
      expiresIn: '7d',
      issuer: 'chatvibes-auth',
      audience: 'chatvibes-api',
    },
  );
}

/**
 * Create test user data
 */
export function createTestUser(login: string = 'testuser') {
  return {
    userId: `123456789`,
    userLogin: login.toLowerCase(),
    displayName: login,
  };
}

/**
 * Get Firestore instance for testing
 */
export function getTestDb() {
  return admin.firestore();
}

/**
 * Clear Firestore test data
 */
export async function clearTestData(): Promise<void> {
  const db = getTestDb();
  const collections = ['managedChannels', 'ttsChannelConfigs', 'shortlinks', 'ttsUserPreferences'];
  
  for (const collectionName of collections) {
    const snapshot = await db.collection(collectionName).get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
  }
}

/**
 * Set environment variables for testing
 */
export function setupTestEnv(): void {
  process.env.FUNCTIONS_EMULATOR = 'true';
  process.env.FIREBASE_EMULATOR_HUB = 'localhost:4400';
  process.env.GCLOUD_PROJECT = 'test-project';
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.TWITCH_CLIENT_ID = 'test-client-id';
  process.env.TWITCH_CLIENT_SECRET = 'test-client-secret';
  process.env.FRONTEND_URL = 'http://localhost:5002';
  process.env.CALLBACK_URL = 'http://localhost:5001/test-project/us-central1/webUi/auth/twitch/callback';
  process.env.USE_ENV_SECRETS = '1';
}

