"use strict";
/**
 * Unit tests for Twitch service token logic
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Mock modules before importing
const mockDb = {
    collection: jest.fn().mockReturnThis(),
    doc: jest.fn().mockReturnThis(),
    get: jest.fn(),
    update: jest.fn(),
};
const mockSecretManagerClient = {
    accessSecretVersion: jest.fn(),
    addSecretVersion: jest.fn(),
};
const mockConfig = {
    GCLOUD_PROJECT: 'test-project',
};
jest.mock('../firestore', () => ({
    db: mockDb,
    COLLECTIONS: { MANAGED_CHANNELS: 'managedChannels' },
}));
jest.mock('../../config', () => ({
    secretManagerClient: mockSecretManagerClient,
    config: mockConfig,
}));
jest.mock('axios');
const axios_1 = __importDefault(require("axios"));
const mockedAxios = axios_1.default;
describe('Twitch service', () => {
    let twitch;
    beforeEach(() => {
        // Set up environment
        process.env.GCLOUD_PROJECT = 'test-project';
        // Clear all mocks
        jest.clearAllMocks();
        // Mock console methods
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'warn').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();
        // Load twitch module AFTER mocks are set up
        twitch = require('../twitch');
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });
    describe('refreshTwitchToken', () => {
        it('should successfully refresh a token', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_ID: 'test-client-id',
                TWITCH_CLIENT_SECRET: 'test-client-secret',
            };
            const mockResponse = {
                data: {
                    access_token: 'new-access-token',
                    refresh_token: 'new-refresh-token',
                    expires_in: 3600,
                },
            };
            mockedAxios.post.mockResolvedValueOnce(mockResponse);
            const result = await twitch.refreshTwitchToken('old-refresh-token', mockSecrets);
            expect(result).toEqual({
                newAccessToken: 'new-access-token',
                newRefreshToken: 'new-refresh-token',
                expiresAt: expect.any(Date),
            });
            expect(mockedAxios.post).toHaveBeenCalledWith(twitch.TWITCH_TOKEN_URL, null, {
                params: {
                    client_id: 'test-client-id',
                    client_secret: 'test-client-secret',
                    grant_type: 'refresh_token',
                    refresh_token: 'old-refresh-token',
                },
            });
            // Verify expiration time is approximately correct (within 1 second)
            const expectedExpiresAt = new Date(Date.now() + 3600 * 1000);
            const actualExpiresAt = result.expiresAt;
            expect(Math.abs(actualExpiresAt.getTime() - expectedExpiresAt.getTime())).toBeLessThan(1000);
        });
        it('should throw error if client ID is missing', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_SECRET: 'test-client-secret',
            };
            await expect(twitch.refreshTwitchToken('refresh-token', mockSecrets)).rejects.toThrow('Server configuration error for Twitch token refresh.');
        });
        it('should throw error if client secret is missing', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_ID: 'test-client-id',
            };
            await expect(twitch.refreshTwitchToken('refresh-token', mockSecrets)).rejects.toThrow('Server configuration error for Twitch token refresh.');
        });
        it('should throw error if Twitch returns no access_token', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_ID: 'test-client-id',
                TWITCH_CLIENT_SECRET: 'test-client-secret',
            };
            const mockResponse = {
                data: {
                    refresh_token: 'new-refresh-token',
                    expires_in: 3600,
                },
            };
            mockedAxios.post.mockResolvedValueOnce(mockResponse);
            await expect(twitch.refreshTwitchToken('refresh-token', mockSecrets)).rejects.toThrow();
        });
        it('should throw error if Twitch returns no refresh_token', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_ID: 'test-client-id',
                TWITCH_CLIENT_SECRET: 'test-client-secret',
            };
            const mockResponse = {
                data: {
                    access_token: 'new-access-token',
                    expires_in: 3600,
                },
            };
            mockedAxios.post.mockResolvedValueOnce(mockResponse);
            await expect(twitch.refreshTwitchToken('refresh-token', mockSecrets)).rejects.toThrow();
        });
        it('should handle Twitch API errors', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_ID: 'test-client-id',
                TWITCH_CLIENT_SECRET: 'test-client-secret',
            };
            mockedAxios.post.mockRejectedValueOnce({
                response: {
                    data: { message: 'Invalid refresh token' },
                },
            });
            await expect(twitch.refreshTwitchToken('invalid-refresh-token', mockSecrets)).rejects.toThrow('Failed to refresh Twitch token');
        });
    });
    describe('validateTwitchToken', () => {
        it('should successfully validate a token', async () => {
            const mockValidationData = {
                client_id: 'test-client-id',
                login: 'testuser',
                scopes: ['user:read:email'],
                user_id: '12345',
                expires_in: 3600,
            };
            mockedAxios.get.mockResolvedValueOnce({
                data: mockValidationData,
            });
            const result = await twitch.validateTwitchToken('valid-token');
            expect(result).toEqual(mockValidationData);
            expect(mockedAxios.get).toHaveBeenCalledWith(twitch.TWITCH_VALIDATE_URL, {
                headers: { Authorization: 'OAuth valid-token' },
            });
        });
        it('should throw error for invalid token', async () => {
            mockedAxios.get.mockRejectedValueOnce({
                response: {
                    data: { message: 'Invalid OAuth token' },
                },
            });
            await expect(twitch.validateTwitchToken('invalid-token')).rejects.toThrow('Token validation failed');
        });
    });
    describe('getAppAccessToken', () => {
        it('should successfully get an app access token', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_ID: 'test-client-id',
                TWITCH_CLIENT_SECRET: 'test-client-secret',
            };
            const mockResponse = {
                data: {
                    access_token: 'app-access-token',
                    expires_in: 5000000,
                },
            };
            mockedAxios.post.mockResolvedValueOnce(mockResponse);
            const result = await twitch.getAppAccessToken(mockSecrets);
            expect(result).toBe('app-access-token');
            expect(mockedAxios.post).toHaveBeenCalledWith(twitch.TWITCH_TOKEN_URL, null, {
                params: {
                    client_id: 'test-client-id',
                    client_secret: 'test-client-secret',
                    grant_type: 'client_credentials',
                },
                timeout: 15000,
            });
        });
        it('should throw error if no access token in response', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_ID: 'test-client-id',
                TWITCH_CLIENT_SECRET: 'test-client-secret',
            };
            mockedAxios.post.mockResolvedValueOnce({
                data: {},
            });
            await expect(twitch.getAppAccessToken(mockSecrets)).rejects.toThrow('Failed to get app access token');
        });
        it('should handle network errors', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_ID: 'test-client-id',
                TWITCH_CLIENT_SECRET: 'test-client-secret',
            };
            mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));
            await expect(twitch.getAppAccessToken(mockSecrets)).rejects.toThrow('Failed to get app access token');
        });
    });
    describe('getUserIdFromUsername', () => {
        it('should successfully get user ID from username', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_ID: 'test-client-id',
                TWITCH_CLIENT_SECRET: 'test-client-secret',
            };
            // Mock app access token call
            mockedAxios.post.mockResolvedValueOnce({
                data: { access_token: 'app-token' },
            });
            // Mock user lookup call
            mockedAxios.get.mockResolvedValueOnce({
                data: {
                    data: [
                        { id: '12345', login: 'testuser', display_name: 'TestUser' },
                    ],
                },
            });
            const result = await twitch.getUserIdFromUsername('testuser', mockSecrets);
            expect(result).toBe('12345');
            expect(mockedAxios.get).toHaveBeenCalledWith(`${twitch.TWITCH_HELIX_BASE}/users`, {
                params: { login: 'testuser' },
                headers: {
                    'Authorization': 'Bearer app-token',
                    'Client-Id': 'test-client-id',
                },
                timeout: 15000,
            });
        });
        it('should return null if user not found', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_ID: 'test-client-id',
                TWITCH_CLIENT_SECRET: 'test-client-secret',
            };
            mockedAxios.post.mockResolvedValueOnce({
                data: { access_token: 'app-token' },
            });
            mockedAxios.get.mockResolvedValueOnce({
                data: { data: [] },
            });
            const result = await twitch.getUserIdFromUsername('nonexistent', mockSecrets);
            expect(result).toBeNull();
        });
        it('should handle errors and return null', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_ID: 'test-client-id',
                TWITCH_CLIENT_SECRET: 'test-client-secret',
            };
            mockedAxios.post.mockResolvedValueOnce({
                data: { access_token: 'app-token' },
            });
            mockedAxios.get.mockRejectedValueOnce(new Error('API error'));
            const result = await twitch.getUserIdFromUsername('testuser', mockSecrets);
            expect(result).toBeNull();
        });
        it('should normalize username to lowercase', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_ID: 'test-client-id',
                TWITCH_CLIENT_SECRET: 'test-client-secret',
            };
            mockedAxios.post.mockResolvedValueOnce({
                data: { access_token: 'app-token' },
            });
            mockedAxios.get.mockResolvedValueOnce({
                data: {
                    data: [{ id: '12345', login: 'testuser' }],
                },
            });
            await twitch.getUserIdFromUsername('TestUser', mockSecrets);
            expect(mockedAxios.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                params: { login: 'testuser' }, // lowercase
            }));
        });
    });
    describe('addModerator', () => {
        beforeEach(() => {
            // Reset Firestore mocks
            mockDb.collection.mockReturnValue(mockDb);
            mockDb.doc.mockReturnValue(mockDb);
        });
        it('should successfully add a moderator (204 response)', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_ID: 'test-client-id',
                TWITCH_CLIENT_SECRET: 'test-client-secret',
            };
            // Mock getValidTwitchTokenForUser dependencies
            mockDb.get.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    twitchUserId: 'broadcaster-123',
                    twitchAccessTokenExpiresAt: { toDate: () => new Date(Date.now() + 10 * 60 * 1000) },
                    needsTwitchReAuth: false,
                }),
            });
            mockSecretManagerClient.accessSecretVersion.mockResolvedValueOnce([{
                    payload: { data: Buffer.from('valid-access-token') },
                }]);
            mockedAxios.post.mockResolvedValueOnce({
                status: 204,
            });
            const result = await twitch.addModerator('broadcasterlogin', 'broadcaster-123', 'moderator-456', mockSecrets);
            expect(result).toEqual({ success: true });
        });
        it('should handle 403 (already moderator) as success', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_ID: 'test-client-id',
                TWITCH_CLIENT_SECRET: 'test-client-secret',
            };
            mockDb.get.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    twitchUserId: 'broadcaster-123',
                    twitchAccessTokenExpiresAt: { toDate: () => new Date(Date.now() + 10 * 60 * 1000) },
                    needsTwitchReAuth: false,
                }),
            });
            mockSecretManagerClient.accessSecretVersion.mockResolvedValueOnce([{
                    payload: { data: Buffer.from('valid-access-token') },
                }]);
            mockedAxios.post.mockRejectedValueOnce({
                response: {
                    status: 403,
                    data: { message: 'User is already a moderator' },
                },
            });
            const result = await twitch.addModerator('broadcasterlogin', 'broadcaster-123', 'moderator-456', mockSecrets);
            expect(result).toEqual({ success: true });
        });
        it('should handle 401 (missing scope) with error message', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_ID: 'test-client-id',
                TWITCH_CLIENT_SECRET: 'test-client-secret',
            };
            mockDb.get.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    twitchUserId: 'broadcaster-123',
                    twitchAccessTokenExpiresAt: { toDate: () => new Date(Date.now() + 10 * 60 * 1000) },
                    needsTwitchReAuth: false,
                }),
            });
            mockSecretManagerClient.accessSecretVersion.mockResolvedValueOnce([{
                    payload: { data: Buffer.from('valid-access-token') },
                }]);
            mockedAxios.post.mockRejectedValueOnce({
                response: {
                    status: 401,
                    data: { message: 'Missing required scope' },
                },
            });
            const result = await twitch.addModerator('broadcasterlogin', 'broadcaster-123', 'moderator-456', mockSecrets);
            expect(result.success).toBe(false);
            expect(result.error).toContain('Authentication failed');
        });
        it('should handle 400 (bad request) with error message', async () => {
            const mockSecrets = {
                TWITCH_CLIENT_ID: 'test-client-id',
                TWITCH_CLIENT_SECRET: 'test-client-secret',
            };
            mockDb.get.mockResolvedValueOnce({
                exists: true,
                data: () => ({
                    twitchUserId: 'broadcaster-123',
                    twitchAccessTokenExpiresAt: { toDate: () => new Date(Date.now() + 10 * 60 * 1000) },
                    needsTwitchReAuth: false,
                }),
            });
            mockSecretManagerClient.accessSecretVersion.mockResolvedValueOnce([{
                    payload: { data: Buffer.from('valid-access-token') },
                }]);
            mockedAxios.post.mockRejectedValueOnce({
                response: {
                    status: 400,
                    data: { message: 'User is banned' },
                },
            });
            const result = await twitch.addModerator('broadcasterlogin', 'broadcaster-123', 'moderator-456', mockSecrets);
            expect(result.success).toBe(false);
            expect(result.error).toBe('User is banned');
        });
    });
});
//# sourceMappingURL=twitch.test.js.map