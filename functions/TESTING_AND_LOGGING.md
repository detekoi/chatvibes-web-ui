# Testing & Structured Logging Guide

This document describes the testing infrastructure and structured logging implementation for the ChatVibes TTS Web UI Firebase Functions.

## Testing Infrastructure

### Overview

We've implemented a comprehensive testing framework using:
- **Jest** - Testing framework
- **TypeScript** - For test files only (gradual migration)
- **ts-jest** - TypeScript support for Jest
- **Mocks** - For Firestore, Secret Manager, and external APIs

### Test Structure

```
functions/
├── src/
│   └── services/
│       └── __tests__/
│           ├── utils.test.ts       # 37 unit tests
│           └── twitch.test.ts      # 19 unit tests
├── jest.config.js                  # Jest configuration
├── tsconfig.json                   # TypeScript configuration
└── package.json                    # Test scripts
```

### Running Tests

```bash
# Run all tests
npm test

# Run only unit tests
npm run test:unit

# Run with coverage
npm run test:coverage

# Watch mode (auto-rerun on changes)
npm run test:watch
```

### Test Coverage

Current coverage for tested modules:
- **src/services/utils.js**: 56% (37 tests)
- **src/services/twitch.js**: 73% (19 tests)
- **Overall services**: 67.83%

### Writing New Tests

Tests are written in TypeScript (`.test.ts` files) for better type safety:

```typescript
// Example test structure
describe('myFunction', () => {
  beforeEach(() => {
    // Setup mocks
    jest.clearAllMocks();
  });

  it('should do something', () => {
    // Test implementation
    expect(result).toBe(expected);
  });
});
```

### Mocking Best Practices

1. **Mock before imports**: Set up mocks before requiring modules
2. **Use `mockResolvedValueOnce`**: For sequential different responses
3. **Clear mocks**: Always call `jest.clearAllMocks()` in `beforeEach`
4. **Test error cases**: Don't just test happy paths

Example:
```typescript
// Mock at top of file
const mockDb = { get: jest.fn(), update: jest.fn() };
jest.mock('../firestore', () => ({ db: mockDb }));

// Then import
const twitch = require('../twitch');

// Test
it('should handle errors', async () => {
  mockDb.get.mockRejectedValueOnce(new Error('DB error'));
  await expect(twitch.someFunction()).rejects.toThrow();
});
```

---

## Structured Logging

### Overview

We've migrated from `console.log` to **Pino** structured logging for:
- Better production observability
- Google Cloud Logging integration
- Request correlation IDs
- Automatic sensitive data redaction

### Logger Module

Located at `src/logger.js`, provides:
- **logger**: Base Pino logger instance
- **createLogger(context)**: Create child logger with context
- **requestLoggingMiddleware**: Express middleware for request logging
- **redactSensitive(data)**: Redact sensitive data before logging

### Usage

#### Basic Logging

```javascript
const {createLogger} = require('./logger');
const logger = createLogger({module: 'myModule'});

// Log levels
logger.debug('Detailed debug info');
logger.info('General information');
logger.warn('Warning message');
logger.error({err: error}, 'Error occurred');
```

#### With Context Data

```javascript
// Good: Structured data in object
logger.info({userId, channelName}, 'User action completed');

// Bad: String interpolation (doesn't structure data)
logger.info(`User ${userId} completed action`); // Don't do this
```

#### Error Logging

```javascript
try {
  // ... code
} catch (error) {
  logger.error({err: error, context: 'additional info'}, 'Operation failed');
}
```

#### Request-Scoped Logging

The `requestLoggingMiddleware` automatically creates request-scoped loggers:

```javascript
app.use(requestLoggingMiddleware);

app.get('/api/endpoint', (req, res) => {
  // Use req.log for request-specific logging
  req.log.info({action: 'processing'}, 'Handling request');

  // Correlation ID is automatically included
  console.log(req.correlationId); // UUID for this request
});
```

### Sensitive Data Redaction

The `redactSensitive()` function automatically redacts:
- Tokens (access_token, refreshToken, etc.)
- Secrets (JWT_SECRET, API keys, etc.)
- Passwords
- Authorization headers

**Usage:**

```javascript
const {redactSensitive} = require('./logger');

// Before logging external API responses
const response = await twitchApi.call();
logger.info({response: redactSensitive(response.data)}, 'API response received');
```

**What gets redacted:**
- Any key containing: `token`, `secret`, `password`, `key`, `authorization`
- Case-insensitive matching
- Works on nested objects

### Development vs Production

#### Development (Emulator)
- **Pretty printing** with colors and timestamps
- Easier to read console output
- Activated when `FUNCTIONS_EMULATOR=true`

Example output:
```
[20:46:49.548] INFO: Client initialized successfully
    module: "firestore"
```

#### Production (Cloud Functions)
- **Structured JSON** for Cloud Logging
- Automatic severity mapping (INFO, WARNING, ERROR, etc.)
- Machine-parseable for log analysis

Example output:
```json
{
  "severity": "INFO",
  "level": 20,
  "time": "2025-11-03T20:46:49.548Z",
  "module": "firestore",
  "msg": "Client initialized successfully"
}
```

### Log Levels

| Level | Number | When to Use |
|-------|--------|-------------|
| debug | 10 | Detailed debugging info (verbose) |
| info | 20 | General informational messages |
| warn | 30 | Warning messages (non-critical issues) |
| error | 40 | Error conditions |
| fatal | 50 | Fatal errors (application crash) |

### Request Correlation

Every HTTP request gets a unique correlation ID:
- Generated as UUID
- Included in all logs for that request
- Allows tracing a single request through multiple log entries

To trace a request in Cloud Logging:
1. Find any log entry for the request
2. Copy the `correlationId` value
3. Filter logs by: `correlationId="<uuid>"`

### Migration Checklist

When adding logging to new code:

- [ ] Import the logger: `const {createLogger} = require('./logger')`
- [ ] Create module-specific logger: `const logger = createLogger({module: 'myModule'})`
- [ ] Use structured logging with objects: `logger.info({key: value}, 'Message')`
- [ ] Redact sensitive data: `redactSensitive(data)` before logging
- [ ] Use appropriate log levels (debug/info/warn/error)
- [ ] Include relevant context (userId, channelName, action, etc.)

### Common Patterns

#### Starting operations
```javascript
logger.info({userId, channelName}, 'Starting bot addition');
```

#### Successful operations
```javascript
logger.info({userId, result}, 'Bot added successfully');
```

#### Warnings
```javascript
logger.warn({userId, reason}, 'Token refresh skipped');
```

#### Errors
```javascript
logger.error({err, userId, operation: 'addBot'}, 'Failed to add bot');
```

#### External API calls
```javascript
logger.debug({endpoint, params}, 'Calling Twitch API');
const response = await axios.get(endpoint, params);
logger.info({status: response.status}, 'Twitch API response received');
```

### Security Best Practices

1. **Never log raw tokens or secrets**
   - Always use `redactSensitive()` for API responses
   - Don't log authorization headers
   - Don't log user passwords

2. **Don't log PII unnecessarily**
   - Log user IDs, not email addresses (unless necessary)
   - Redact sensitive user data

3. **Sanitize error messages**
   - External errors may contain sensitive data
   - Use `redactSensitive()` on error objects from external APIs

---

## Deployment

### Before Deploying

1. **Run tests**:
   ```bash
   npm test
   ```

2. **Check for lint issues**:
   ```bash
   npm run lint
   ```

3. **Verify no sensitive data in logs**:
   ```bash
   # Search for any hardcoded tokens/secrets
   grep -r "token.*:" src/ --include="*.js"
   ```

### Deploy

```bash
# Deploy functions
npm run deploy

# Or deploy everything
firebase deploy
```

### Viewing Logs in Production

**Google Cloud Console:**
1. Go to Cloud Logging
2. Filter by severity: `severity>=WARNING` (for errors only)
3. Filter by module: `jsonPayload.module="twitch"`
4. Trace requests: `jsonPayload.correlationId="<uuid>"`

**Firebase Console:**
```bash
npm run logs
```

---

## Troubleshooting

### Tests Failing

**Issue**: Mocks not working
- **Solution**: Ensure mocks are defined before `require()`
- **Solution**: Check mock function names match the actual exports

**Issue**: Async test timeouts
- **Solution**: Increase timeout in jest.config.js (`testTimeout: 30000`)
- **Solution**: Ensure async functions use `await` or return promises

### Logging Issues

**Issue**: Logs not appearing in Cloud Logging
- **Solution**: Check severity level (only WARNING and above show by default)
- **Solution**: Verify structured format (use objects, not just strings)

**Issue**: Pretty printing not working locally
- **Solution**: Ensure `FUNCTIONS_EMULATOR=true` is set
- **Solution**: Check `pino-pretty` is installed as devDependency

**Issue**: Sensitive data appearing in logs
- **Solution**: Use `redactSensitive()` for external API responses
- **Solution**: Review log statements for hardcoded values

---

## Next Steps

### Recommended Additions

1. **Integration Tests**
   - Test API endpoints with Firebase emulator
   - Use `firebase-functions-test` for integration testing
   - Test Firestore read/write operations

2. **E2E Tests**
   - Test complete OAuth flow
   - Test bot add/remove with real Twitch API (sandbox)
   - Validate state changes in Firestore

3. **CI/CD Integration**
   - Run tests on every commit
   - Automated deployment on main branch merge
   - Coverage reporting in PR comments

4. **TypeScript Migration**
   - Gradually migrate source files to TypeScript
   - Add interfaces for data structures
   - Enable `strict` mode incrementally

---

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Pino Documentation](https://getpino.io/#/)
- [Google Cloud Logging](https://cloud.google.com/logging/docs)
- [Firebase Functions Testing](https://firebase.google.com/docs/functions/unit-testing)
