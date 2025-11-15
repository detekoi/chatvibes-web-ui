# ChatVibes Web UI - OAuth Scope Audit Report

## Executive Summary

This audit identifies which OAuth scopes are **declared** vs. **actually used** in the ChatVibes web UI application. The application currently requests 8 scopes but only actively uses **3** of them.

---

## 1. Declared Scopes

### Location: `/home/user/chatvibes-web-ui/functions/src/auth/routes.ts` (Line 184)

```
scope: "user:read:email chat:read chat:edit channel:read:subscriptions bits:read moderator:read:followers channel:manage:redemptions channel:read:redemptions channel:manage:moderators"
```

### Full List of Declared Scopes (8 total):
1. `user:read:email` 
2. `chat:read`
3. `chat:edit`
4. `channel:read:subscriptions`
5. `bits:read`
6. `moderator:read:followers`
7. `channel:manage:redemptions`
8. `channel:read:redemptions`
9. `channel:manage:moderators`

---

## 2. Actually Used Scopes

### Scope 1: `user:read:email` - USED ✓

**Purpose:** Retrieve user email address during OAuth callback

**File:** `/home/user/chatvibes-web-ui/functions/src/auth/routes.ts:257-262`

**Endpoint Called:**
```
GET https://api.twitch.tv/helix/users
Headers:
  - Authorization: Bearer {access_token}
  - Client-Id: {client_id}
```

**Response Data Used:**
```typescript
const userData = userResponse.data.data[0];
const twitchUser = {
  id: validateResponse.data.user_id,
  login: validateResponse.data.login.toLowerCase(),
  displayName: userData?.display_name || validateResponse.data.login,
  email: userData?.email || null,  // <-- EMAIL REQUIRED
};
```

**Token Type:** User's OAuth access token (from authorization code flow)

**Implementation Details:**
- Called during `/auth/twitch/callback` endpoint
- Email is stored in Firestore document under field `email`
- This is a standard OAuth flow requirement

---

### Scope 2: `channel:manage:moderators` - USED ✓

**Purpose:** Automatically add the bot account as a moderator when users enable the bot

**Files:** 
- `/home/user/chatvibes-web-ui/functions/src/services/twitch.ts:343-407` (implementation)
- `/home/user/chatvibes-web-ui/functions/src/api/bot.ts:126-151` (caller)

**Endpoints Called:**

```
GET https://api.twitch.tv/helix/users
(to resolve bot username to user ID - uses app token, no scope needed)

POST https://api.twitch.tv/helix/moderation/moderators
Query Parameters:
  - broadcaster_id: {channel_user_id}
  - user_id: {bot_user_id}
Headers:
  - Authorization: Bearer {channel_owner_access_token}
  - Client-Id: {client_id}
```

**Flow:**
1. User clicks "Add Bot" button
2. Bot queries `/api/bot/add` endpoint
3. System retrieves bot username from config
4. Bot looks up bot's Twitch user ID using app token
5. System calls POST `/helix/moderation/moderators` with channel owner's token
6. Bot is added as moderator to the channel

**Token Type:** Channel owner's OAuth access token (requires broadcaster context)

**Error Handling:**
- 401: Missing scope or invalid token - user must re-authenticate
- 403: User already a moderator (treated as success)
- 400: User cannot be added (banned, VIP, etc.)

---

### Scope 3: `channel:manage:redemptions` - USED ✓

**Purpose:** Create, read, update, and delete custom channel points rewards

**Files:**
- `/home/user/chatvibes-web-ui/functions/src/api/rewards.ts:113-242` (core implementation)
- `/home/user/chatvibes-web-ui/functions/src/api/rewards.ts:291-475` (upsert handler)

**Endpoints Called:**

```
POST https://api.twitch.tv/helix/channel_points/custom_rewards
(Create a new reward)

GET https://api.twitch.tv/helix/channel_points/custom_rewards?only_manageable_rewards=true
(List existing rewards)

PATCH https://api.twitch.tv/helix/channel_points/custom_rewards
(Update existing reward)

DELETE https://api.twitch.tv/helix/channel_points/custom_rewards
(Delete reward)

Headers (all):
  - Authorization: Bearer {channel_owner_access_token}
  - Client-Id: {client_id}
  - Content-Type: application/json
```

**Operations:**
1. **GET** `/api/rewards/tts` - Fetch current channel points configuration
   - Calls GET `/helix/channel_points/custom_rewards` to get Twitch status
   - Line: 271 in rewards.ts

2. **POST** `/api/rewards/tts` - Create or update TTS reward
   - Calls `ensureTtsChannelPointReward()` which:
     - POSTs to create new reward (line 226)
     - GETs to list rewards (line 200)
     - PATCHes to update reward (lines 183, 206, 378)

3. **DELETE** `/api/rewards/tts` - Delete TTS reward
   - Calls DELETE `/helix/channel_points/custom_rewards` (line 516)

**Token Type:** Channel owner's OAuth access token

**Implementation Details:**
- Creates a standardized "Text-to-Speech Message" reward
- Default cost: 500 channel points
- Allows viewers to request TTS messages via chat
- Supports cooldowns, per-stream limits, and per-user limits

---

## 3. Unused Scopes

### Scope: `chat:read` - NOT USED ❌

**Declared but never used**

**What it would enable:** Read chat messages and events

**Why it's not needed:** The bot doesn't read chat messages from this web UI. The main TTS bot service (separate application) handles chat interactions via IRC.

---

### Scope: `chat:edit` - NOT USED ❌

**Declared but never used**

**What it would enable:** Send messages to chat

**Why it's not needed:** This web UI is for bot management only. The main TTS bot service sends chat messages.

---

### Scope: `channel:read:subscriptions` - NOT USED ❌

**Declared but never used**

**What it would enable:** Read subscription tier information

**Why it's not needed:** The web UI doesn't track or display subscription data.

---

### Scope: `bits:read` - NOT USED ❌

**Declared but never used**

**What it would enable:** Read bits/cheers information

**Why it's not needed:** The web UI doesn't process or track bits.

---

### Scope: `moderator:read:followers` - NOT USED ❌

**Declared but never used**

**What it would enable:** Read follower list

**Why it's not needed:** The web UI doesn't display or process follower data.

---

### Scope: `channel:read:redemptions` - NOT USED ❌

**Declared but never used**

**What it would enable:** Read channel points redemptions (read-only)

**Why it's not needed:** The web UI only needs to manage (create/update/delete) rewards, not read redemptions. Additionally, the app uses `channel:manage:redemptions` which includes read permissions implicitly.

---

## 4. Summary Table

| Scope | Used | Purpose | API Endpoint |
|-------|------|---------|--------------|
| `user:read:email` | ✓ YES | Get user email during OAuth | GET /helix/users |
| `chat:read` | ❌ NO | (Would read chat) | N/A |
| `chat:edit` | ❌ NO | (Would send messages) | N/A |
| `channel:read:subscriptions` | ❌ NO | (Would read subscriptions) | N/A |
| `bits:read` | ❌ NO | (Would read bits) | N/A |
| `moderator:read:followers` | ❌ NO | (Would read followers) | N/A |
| `channel:manage:redemptions` | ✓ YES | Manage channel points rewards | POST/PATCH/DELETE /helix/channel_points/custom_rewards |
| `channel:read:redemptions` | ❌ NO | (Read-only redemptions) | N/A |
| `channel:manage:moderators` | ✓ YES | Add bot as moderator | POST /helix/moderation/moderators |

**Total Scopes Declared:** 9  
**Total Scopes Actually Used:** 3  
**Unused Scopes:** 6  
**Scope Usage Efficiency:** 33%

---

## 5. Recommendations

### HIGH PRIORITY: Remove Unused Scopes

The following scopes should be **removed** from the OAuth request to reduce the permission surface:

1. `chat:read` - Not needed
2. `chat:edit` - Not needed
3. `channel:read:subscriptions` - Not needed
4. `bits:read` - Not needed
5. `moderator:read:followers` - Not needed
6. `channel:read:redemptions` - Redundant (covered by `channel:manage:redemptions`)

### Recommended Scope String (Minimal):
```
"user:read:email channel:manage:redemptions channel:manage:moderators"
```

**Benefits:**
- Better security posture (principle of least privilege)
- Users see fewer permission requests
- Reduced risk if tokens are compromised
- Easier to audit and maintain

---

## 6. Implementation Locations

### OAuth Scope Declaration:
- **File:** `/home/user/chatvibes-web-ui/functions/src/auth/routes.ts`
- **Line:** 184
- **Route:** `/auth/twitch/initiate`

### Viewer OAuth (Empty Scope):
- **File:** `/home/user/chatvibes-web-ui/functions/src/auth/routes.ts`
- **Line:** 441
- **Route:** `/auth/twitch/viewer`
- **Note:** Viewers request no scopes (empty string), which is correct

### Token Validation & Usage:
- **File:** `/home/user/chatvibes-web-ui/functions/src/services/twitch.ts`
- **Functions:** 
  - `getValidTwitchTokenForUser()` - Manages token refresh
  - `makeTwitchApiRequest()` - Makes Helix API calls
  - `validateTwitchToken()` - Validates token scopes

---

## 7. Token Management Details

### User Tokens (from OAuth)
- **Storage:** Google Cloud Secret Manager
- **Location:** `twitch-access-token-{userId}` and `twitch-refresh-token-{userId}`
- **Refresh:** Automatic via `/api/auth/refresh` endpoint
- **Expiration:** 1 hour (with 5-minute buffer for refresh)

### App Tokens (Client Credentials)
- **Used for:** Looking up bot user ID (no user context needed)
- **Function:** `getAppAccessToken()` in services/twitch.ts
- **No scopes required** (app tokens don't have scopes)

---

## Conclusion

The ChatVibes web UI can be securely configured with just **3 scopes** instead of 9:
- `user:read:email`
- `channel:manage:redemptions` 
- `channel:manage:moderators`

This represents a significant security improvement while maintaining full functionality.
