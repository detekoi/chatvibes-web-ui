# API Integration Tests

Integration tests for ChatVibes Web UI API endpoints using Firebase emulator.

## Prerequisites

1. Install the **Firebase Emulator Suite**:
   ```bash
   npm install -g firebase-tools
   firebase init emulators
   ```

2. Configure the **Firestore Emulator** in `firebase.json`:
   ```json
   {
     "emulators": {
       "firestore": {
         "port": 8080
       }
     }
   }
   ```

## Running Tests

### Option 1: Run with Emulator (Recommended)

1. Start the Firebase emulator in one terminal:
   ```bash
   firebase emulators:start --only firestore
   ```

2. In another terminal, run integration tests:
   ```bash
   npm run test:integration
   ```

### Option 2: Run without Emulator

Tests can run without the emulator. However, tests that interact with Firestore skip or stop with a timeout.

```bash
npm run test:integration
```

## Test Structure

- **health.integration.test.ts** - Tests for `/health` endpoint
- **auth.integration.test.ts** - Tests for `/api/auth/*` endpoints
- **bot.integration.test.ts** - Tests for `/api/bot/*` endpoints
- **viewer.integration.test.ts** - Tests for `/api/viewer/*` endpoints
- **misc.integration.test.ts** - Tests for `/api/shortlink`, `/api/tts/test`, `/s/:slug`

## Test Helpers

- **appHelper.ts** - Creates Express app instance for testing
- **testHelpers.ts** - Utilities for creating test tokens, users, and Firestore operations

## Writing New Tests

```typescript
import {describe, it, expect, beforeAll, beforeEach} from '@jest/globals';
import request from 'supertest';
import {createTestApp} from './appHelper';
import {createTestToken, createTestUser, getTestDb, clearTestData} from './testHelpers';

describe('My API Integration Tests', () => {
  let app: any;
  let db: any;
  const testUser = createTestUser('testuser');

  beforeAll(async () => {
    app = await createTestApp();
    db = getTestDb();
  });

  beforeEach(async () => {
    await clearTestData(); // Cleans up Firestore between tests
  });

  it('should test an endpoint', async () => {
    const token = createTestToken(testUser);
    const response = await request(app)
        .get('/api/endpoint')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    
    expect(response.body.success).toBe(true);
  });
});
```

## Notes

- Tests use `supertest` for HTTP request tests.
- Authenticated endpoints generate JWT tokens automatically.
- When the emulator runs, Firestore data clears between tests.
- Test mode sets environment variables automatically.

