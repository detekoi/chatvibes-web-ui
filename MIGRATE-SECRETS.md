# Frontend Secret Migration Guide

The backend has been migrated to use Cloud Run's secret mounting. The frontend (Firebase Functions) can benefit from a similar approach.

## Current State

The frontend loads secrets via Secret Manager API in `functions/src/config.ts`:
- ❌ Makes API calls at startup (slow + costs)
- ❌ No caching between function invocations
- ❌ Each cold start accesses Secret Manager

## Option 1: Firebase Functions Secret Environment Variables (Recommended)

Firebase Functions supports mounting secrets as environment variables, similar to Cloud Run.

### Setup

1. **Define secrets in `firebase.json`:**

```json
{
  "functions": [
    {
      "source": "functions",
      "codebase": "default",
      "runtime": "nodejs20",
      "secretEnvironmentVariables": [
        {
          "key": "TWITCH_CLIENT_ID",
          "secret": "twitch-client-id"
        },
        {
          "key": "TWITCH_CLIENT_SECRET",
          "secret": "twitch-client-secret"
        },
        {
          "key": "JWT_SECRET",
          "secret": "jwt-secret-key"
        },
        {
          "key": "WAVESPEED_API_KEY",
          "secret": "WAVESPEED_API_KEY"
        },
        {
          "key": "302_KEY",
          "secret": "302_KEY"
        }
      ]
    }
  ]
}
```

2. **Update `functions/src/config.ts`:**

```typescript
// BEFORE: Async secret loading
const secretsLoadedPromise = (async (): Promise<void> => {
  // ... loads from Secret Manager API ...
})();

// AFTER: Direct environment variable access (already available at startup)
const secrets: Secrets = {
  TWITCH_CLIENT_ID: process.env.TWITCH_CLIENT_ID || "",
  TWITCH_CLIENT_SECRET: process.env.TWITCH_CLIENT_SECRET || "",
  JWT_SECRET: process.env.JWT_SECRET || "",
  WAVESPEED_API_KEY: process.env.WAVESPEED_API_KEY || "",
  "302_KEY": process.env["302_KEY"] || "",
};

// No need for secretsLoadedPromise - secrets are immediately available
export const secretsLoadedPromise = Promise.resolve();

// For local dev, keep the emulator mode check
if (isEmulator && !secrets.TWITCH_CLIENT_ID) {
  secrets.TWITCH_CLIENT_ID = "demo-client-id";
  secrets.TWITCH_CLIENT_SECRET = "demo-client-secret";
  secrets.JWT_SECRET = "local-dev-jwt-secret";
}
```

3. **Deploy:**

```bash
cd ../chatvibes-web-ui
firebase deploy --only functions
```

### Benefits

- ✅ **Zero API access costs** - No Secret Manager API calls
- ✅ **Faster cold starts** - Secrets available immediately
- ✅ **Simpler code** - No async loading logic
- ✅ **Same security** - Secrets still managed by Secret Manager, just mounted differently

## Option 2: Add Caching (If Migration is Not Immediate)

If you can't migrate right away, add caching to reduce API calls:

```typescript
// Cache secrets in memory
let secretsCache: Secrets | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cacheExpiry = 0;

const loadSecret = async (secretName: string): Promise<string> => {
  // Check cache first
  if (secretsCache && Date.now() < cacheExpiry) {
    return secretsCache[secretName as keyof Secrets];
  }

  // Load from Secret Manager...
  const value = await secretManagerClient.accessSecretVersion({...});

  // Update cache
  secretsCache = {...secrets};
  cacheExpiry = Date.now() + CACHE_TTL_MS;

  return value;
};
```

## Cost Comparison

### Current (No Caching)
- Every function cold start = 5 secret accesses
- ~100 cold starts/day = 500 accesses/day = 15,000/month
- Exceeds free tier (10,000/month) - incurs costs

### With Secret Mounting
- Zero API calls
- Secrets mounted at deploy time
- **$0 access cost**
- **Faster function startup**

## Deployment Steps

1. Update `firebase.json` with secret environment variables
2. Update `functions/src/config.ts` to read from `process.env`
3. Update local dev `.env` file with secrets for testing
4. Deploy: `firebase deploy --only functions`
5. Verify in Firebase Console that secrets are mounted
6. Monitor logs for any issues

## Testing Locally

```bash
# Set local environment variables in .env
echo "TWITCH_CLIENT_ID=your_client_id" >> .env
echo "TWITCH_CLIENT_SECRET=your_secret" >> .env
echo "JWT_SECRET=your_jwt_secret" >> .env
echo "WAVESPEED_API_KEY=your_api_key" >> .env
echo "302_KEY=your_302_key" >> .env

# Start emulator
firebase emulators:start
```

## References

- [Firebase Functions Secret Environment Variables](https://firebase.google.com/docs/functions/config-env#secret-manager)
- [Secret Manager Best Practices](https://cloud.google.com/secret-manager/docs/best-practices)
