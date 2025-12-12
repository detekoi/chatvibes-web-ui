# OAuth Token Migration: Secret Manager → Firestore

## Problem

The frontend Firebase Functions are storing **user OAuth tokens in Secret Manager**, causing excessive API costs:

- **Current cost**: ~$1.50/day in Secret Manager API calls (~500K calls/day)
- **Root cause**: Every API request reads/writes user tokens from Secret Manager
- **Why it's wrong**: Secret Manager is for static secrets, not dynamic per-user data

### Current Architecture (EXPENSIVE):
```
User API Request → Firebase Function
                 → Read user token from Secret Manager (1 API call)
                 → If expired, read refresh token (1 API call)
                 → Refresh and write new tokens (2 API calls)
                 = 4 API calls per user request!
```

With many users and frequent requests: **500,000+ Secret Manager API calls/day**

## Solution

Store user OAuth tokens in **Firestore** instead:

### New Architecture (CHEAP):
```
User API Request → Firebase Function
                 → Read tokens from Firestore (fast, cheap)
                 → Write tokens to Firestore (fast, cheap)
                 = Firestore reads/writes (100x cheaper!)
```

**Cost comparison:**
- Secret Manager: $0.03 per 10,000 API calls = $1.50/day for 500K calls
- Firestore: $0.06 per 100,000 reads = $0.03/day for 50K reads

**Savings: ~$1.47/day = ~$44/month** 💰

## Migration Steps

### 1. Run Migration Script (Dry Run First)

```bash
cd ~/Dev/chatvibes-web-ui
npm install --prefix functions firebase-admin  # if not already installed

# Dry run to preview changes
node scripts/migrate-tokens-to-firestore.js

# Execute migration
node scripts/migrate-tokens-to-firestore.js --execute

# Execute + cleanup (delete secrets after migration)
node scripts/migrate-tokens-to-firestore.js --execute --cleanup
```

**What it does:**
- Reads all `twitch-access-token-*` and `twitch-refresh-token-*` secrets
- Stores them in Firestore: `users/{userId}/private/oauth`
- Optionally deletes the secrets from Secret Manager (with `--cleanup`)

### 2. Update Frontend Code

Modify `functions/src/services/twitch.ts` to read/write tokens from Firestore instead of Secret Manager.

**Before (lines 143-146):**
```typescript
const secretName = `projects/${config.GCLOUD_PROJECT}/secrets/twitch-access-token-${twitchUserId}`;
const [version] = await secretManagerClient.accessSecretVersion({
  name: `${secretName}/versions/latest`,
});
const accessToken = version.payload?.data?.toString().trim();
```

**After:**
```typescript
const oauthDoc = await db.collection('users').doc(twitchUserId)
  .collection('private').doc('oauth').get();
const accessToken = oauthDoc.data()?.twitchAccessToken;
```

**Before (lines 180-189):**
```typescript
await Promise.all([
  secretManagerClient.addSecretVersion({
    parent: `projects/${config.GCLOUD_PROJECT}/secrets/twitch-access-token-${twitchUserId}`,
    payload: {data: Buffer.from(newAccessToken)},
  }),
  secretManagerClient.addSecretVersion({
    parent: `projects/${config.GCLOUD_PROJECT}/secrets/twitch-refresh-token-${twitchUserId}`,
    payload: {data: Buffer.from(newRefreshToken)},
  }),
]);
```

**After:**
```typescript
await db.collection('users').doc(twitchUserId)
  .collection('private').doc('oauth').set({
    twitchAccessToken: newAccessToken,
    twitchRefreshToken: newRefreshToken,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
```

### 3. Update Other Files

Search for and replace all Secret Manager token reads:

```bash
# Find all Secret Manager token usage
cd functions/src
grep -r "secretManagerClient.accessSecretVersion" .
grep -r "twitch-access-token\|twitch-refresh-token" .
```

Files to update:
- `functions/src/services/twitch.ts` (main token handling)
- `functions/src/services/utils.ts` (if it reads tokens)
- `functions/src/api/obs.ts` (OBS tokens - may also need migration)

### 4. Deploy and Test

```bash
# Deploy updated functions
firebase deploy --only functions

# Test with a user API request
# Monitor logs to ensure tokens are being read from Firestore
```

### 5. Cleanup (After Verification)

Once you've verified the new code works:

```bash
# Delete all user token secrets from Secret Manager
node scripts/migrate-tokens-to-firestore.js --execute --cleanup
```

## Expected Results

**Before:**
- 67 secret versions @ $0.06/month = $4.02/month storage
- ~500K API calls/day @ $0.03/10K = $1.50/day = $45/month API
- **Total: ~$49/month**

**After:**
- ~20 secret versions @ $0.06/month = $1.20/month storage (only app secrets)
- Minimal API calls (just refreshing app-level secrets) = ~$0.03/month
- Firestore reads: ~50K/day @ $0.06/100K = ~$0.90/month
- **Total: ~$2.13/month**

**Savings: ~$47/month (~96% reduction!!)** 🎉

## OBS Tokens

The `obs.ts` file also stores per-user OBS tokens in Secret Manager:
- `obs-token-{username}`

These should ALSO be migrated to Firestore for the same reasons. The migration script can be extended to handle these, or you can create a similar script specifically for OBS tokens.

## Security Note

Storing OAuth tokens in Firestore is secure because:
- ✅ Firestore has access controls (Security Rules)
- ✅ Tokens are in a `private` subcollection (not publicly readable)
- ✅ Communication is encrypted (HTTPS)
- ✅ This is the standard practice for OAuth tokens in Firebase apps

Secret Manager is designed for **static, application-level secrets** (API keys, client secrets), not **dynamic, per-user data** (OAuth tokens that change hourly).
