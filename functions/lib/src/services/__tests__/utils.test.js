"use strict";
/**
 * Unit tests for utils service
 */
describe('utils', () => {
    let utils;
    beforeEach(() => {
        // Clear module cache to reset environment
        jest.resetModules();
        jest.clearAllMocks();
    });
    describe('getProjectId', () => {
        it('should return project ID from GCLOUD_PROJECT', () => {
            process.env.GCLOUD_PROJECT = 'test-project-1';
            utils = require('../utils');
            expect(utils.getProjectId()).toBe('test-project-1');
        });
        it('should return project ID from GOOGLE_CLOUD_PROJECT', () => {
            delete process.env.GCLOUD_PROJECT;
            process.env.GOOGLE_CLOUD_PROJECT = 'test-project-2';
            utils = require('../utils');
            expect(utils.getProjectId()).toBe('test-project-2');
        });
        it('should prefer GCLOUD_PROJECT over GOOGLE_CLOUD_PROJECT', () => {
            process.env.GCLOUD_PROJECT = 'gcloud-project';
            process.env.GOOGLE_CLOUD_PROJECT = 'google-cloud-project';
            utils = require('../utils');
            expect(utils.getProjectId()).toBe('gcloud-project');
        });
        it('should throw error if no project ID is set', () => {
            delete process.env.GCLOUD_PROJECT;
            delete process.env.GOOGLE_CLOUD_PROJECT;
            utils = require('../utils');
            expect(() => utils.getProjectId()).toThrow('Project ID not configured.');
        });
    });
    describe('normalizeSecretVersionPath', () => {
        beforeEach(() => {
            process.env.GCLOUD_PROJECT = 'test-project';
            utils = require('../utils');
        });
        it('should return path unchanged if it includes /versions/', () => {
            const path = 'projects/test/secrets/my-secret/versions/1';
            expect(utils.normalizeSecretVersionPath(path)).toBe(path);
        });
        it('should append /versions/latest if path does not include /versions/', () => {
            const path = 'projects/test/secrets/my-secret';
            expect(utils.normalizeSecretVersionPath(path)).toBe('projects/test/secrets/my-secret/versions/latest');
        });
        it('should handle short secret names', () => {
            const path = 'my-secret';
            expect(utils.normalizeSecretVersionPath(path)).toBe('my-secret/versions/latest');
        });
    });
    describe('validateSpeed', () => {
        beforeEach(() => {
            process.env.GCLOUD_PROJECT = 'test-project';
            utils = require('../utils');
        });
        it('should accept valid speeds between 0.5 and 2.0', () => {
            expect(utils.validateSpeed(0.5)).toBe(true);
            expect(utils.validateSpeed(1.0)).toBe(true);
            expect(utils.validateSpeed(1.5)).toBe(true);
            expect(utils.validateSpeed(2.0)).toBe(true);
        });
        it('should reject speeds below 0.5', () => {
            expect(utils.validateSpeed(0.4)).toBe(false);
            expect(utils.validateSpeed(0.0)).toBe(false);
            expect(utils.validateSpeed(-1.0)).toBe(false);
        });
        it('should reject speeds above 2.0', () => {
            expect(utils.validateSpeed(2.1)).toBe(false);
            expect(utils.validateSpeed(3.0)).toBe(false);
        });
        it('should reject non-number values', () => {
            expect(utils.validateSpeed('1.0')).toBe(false);
            expect(utils.validateSpeed(null)).toBe(false);
            expect(utils.validateSpeed(undefined)).toBe(false);
            expect(utils.validateSpeed({})).toBe(false);
        });
    });
    describe('validatePitch', () => {
        beforeEach(() => {
            process.env.GCLOUD_PROJECT = 'test-project';
            utils = require('../utils');
        });
        it('should accept valid pitch between -12 and 12', () => {
            expect(utils.validatePitch(-12)).toBe(true);
            expect(utils.validatePitch(-6)).toBe(true);
            expect(utils.validatePitch(0)).toBe(true);
            expect(utils.validatePitch(6)).toBe(true);
            expect(utils.validatePitch(12)).toBe(true);
        });
        it('should reject pitch below -12', () => {
            expect(utils.validatePitch(-13)).toBe(false);
            expect(utils.validatePitch(-20)).toBe(false);
        });
        it('should reject pitch above 12', () => {
            expect(utils.validatePitch(13)).toBe(false);
            expect(utils.validatePitch(20)).toBe(false);
        });
        it('should reject non-number values', () => {
            expect(utils.validatePitch('0')).toBe(false);
            expect(utils.validatePitch(null)).toBe(false);
            expect(utils.validatePitch(undefined)).toBe(false);
        });
    });
    describe('normalizeEmotion', () => {
        beforeEach(() => {
            process.env.GCLOUD_PROJECT = 'test-project';
            utils = require('../utils');
        });
        it('should return null for null, undefined, or empty string', () => {
            expect(utils.normalizeEmotion(null)).toBeNull();
            expect(utils.normalizeEmotion(undefined)).toBeNull();
            expect(utils.normalizeEmotion('')).toBeNull();
        });
        it('should map "auto" to "neutral"', () => {
            expect(utils.normalizeEmotion('auto')).toBe('neutral');
            expect(utils.normalizeEmotion('Auto')).toBe('neutral');
            expect(utils.normalizeEmotion('AUTO')).toBe('neutral');
        });
        it('should normalize canonical emotions', () => {
            expect(utils.normalizeEmotion('neutral')).toBe('neutral');
            expect(utils.normalizeEmotion('happy')).toBe('happy');
            expect(utils.normalizeEmotion('sad')).toBe('sad');
            expect(utils.normalizeEmotion('angry')).toBe('angry');
            expect(utils.normalizeEmotion('fearful')).toBe('fearful');
            expect(utils.normalizeEmotion('disgusted')).toBe('disgusted');
            expect(utils.normalizeEmotion('surprised')).toBe('surprised');
        });
        it('should map legacy emotion synonyms to canonical forms', () => {
            expect(utils.normalizeEmotion('fear')).toBe('fearful');
            expect(utils.normalizeEmotion('surprise')).toBe('surprised');
            expect(utils.normalizeEmotion('disgust')).toBe('disgusted');
        });
        it('should handle case-insensitive input', () => {
            expect(utils.normalizeEmotion('HAPPY')).toBe('happy');
            expect(utils.normalizeEmotion('Happy')).toBe('happy');
            expect(utils.normalizeEmotion('HaPpY')).toBe('happy');
        });
        it('should return unknown emotions as-is (lowercased)', () => {
            expect(utils.normalizeEmotion('excited')).toBe('excited');
            expect(utils.normalizeEmotion('Unknown')).toBe('unknown');
        });
        it('should handle whitespace', () => {
            expect(utils.normalizeEmotion('  happy  ')).toBe('happy');
            expect(utils.normalizeEmotion('\tneutral\n')).toBe('neutral');
        });
    });
    describe('validateEmotion', () => {
        beforeEach(() => {
            process.env.GCLOUD_PROJECT = 'test-project';
            utils = require('../utils');
        });
        it('should accept null', () => {
            expect(utils.validateEmotion(null)).toBe(true);
        });
        it('should accept valid canonical emotions', () => {
            expect(utils.validateEmotion('neutral')).toBe(true);
            expect(utils.validateEmotion('happy')).toBe(true);
            expect(utils.validateEmotion('sad')).toBe(true);
            expect(utils.validateEmotion('angry')).toBe(true);
            expect(utils.validateEmotion('fearful')).toBe(true);
            expect(utils.validateEmotion('disgusted')).toBe(true);
            expect(utils.validateEmotion('surprised')).toBe(true);
        });
        it('should accept valid emotion synonyms (normalizes internally)', () => {
            expect(utils.validateEmotion('fear')).toBe(true);
            expect(utils.validateEmotion('surprise')).toBe(true);
            expect(utils.validateEmotion('disgust')).toBe(true);
        });
        it('should accept "auto" (maps to neutral)', () => {
            expect(utils.validateEmotion('auto')).toBe(true);
            expect(utils.validateEmotion('AUTO')).toBe(true);
        });
        it('should reject invalid emotions', () => {
            expect(utils.validateEmotion('excited')).toBe(false);
            expect(utils.validateEmotion('confused')).toBe(false);
            expect(utils.validateEmotion('unknown')).toBe(false);
        });
        it('should handle case-insensitive input', () => {
            expect(utils.validateEmotion('HAPPY')).toBe(true);
            expect(utils.validateEmotion('Happy')).toBe(true);
        });
    });
    describe('validateLanguageBoost', () => {
        beforeEach(() => {
            process.env.GCLOUD_PROJECT = 'test-project';
            utils = require('../utils');
        });
        it('should accept "auto"', () => {
            expect(utils.validateLanguageBoost('auto')).toBe(true);
        });
        it('should accept valid single languages', () => {
            expect(utils.validateLanguageBoost('English')).toBe(true);
            expect(utils.validateLanguageBoost('Chinese')).toBe(true);
            expect(utils.validateLanguageBoost('Spanish')).toBe(true);
            expect(utils.validateLanguageBoost('French')).toBe(true);
            expect(utils.validateLanguageBoost('Japanese')).toBe(true);
        });
        it('should accept composite language codes', () => {
            expect(utils.validateLanguageBoost('Chinese,Yue')).toBe(true);
        });
        it('should accept all documented language options', () => {
            const validLanguages = [
                'auto', 'English', 'Chinese', 'Chinese,Yue', 'Spanish', 'Hindi',
                'Portuguese', 'Russian', 'Japanese', 'Korean', 'Vietnamese', 'Arabic',
                'French', 'German', 'Turkish', 'Dutch', 'Ukrainian', 'Indonesian',
                'Italian', 'Thai', 'Polish', 'Romanian', 'Greek', 'Czech', 'Finnish',
            ];
            validLanguages.forEach(lang => {
                expect(utils.validateLanguageBoost(lang)).toBe(true);
            });
        });
        it('should reject invalid languages', () => {
            expect(utils.validateLanguageBoost('Klingon')).toBe(false);
            expect(utils.validateLanguageBoost('Unknown')).toBe(false);
            expect(utils.validateLanguageBoost('english')).toBe(false); // case sensitive
        });
        it('should reject non-string values', () => {
            expect(utils.validateLanguageBoost(null)).toBe(false);
            expect(utils.validateLanguageBoost(undefined)).toBe(false);
            expect(utils.validateLanguageBoost(123)).toBe(false);
        });
    });
    describe('createShortLink', () => {
        let mockDb;
        beforeEach(() => {
            process.env.GCLOUD_PROJECT = 'test-project';
            // Mock Firestore
            mockDb = {
                collection: jest.fn().mockReturnThis(),
                doc: jest.fn().mockReturnThis(),
                set: jest.fn().mockResolvedValue(undefined),
            };
            jest.mock('../firestore', () => ({
                db: mockDb,
                COLLECTIONS: { SHORTLINKS: 'shortlinks' },
            }));
            // Clear console.log for cleaner test output
            jest.spyOn(console, 'log').mockImplementation();
            utils = require('../utils');
        });
        afterEach(() => {
            jest.restoreAllMocks();
        });
        it('should create a short link with a random slug', async () => {
            const longUrl = 'https://example.com/very/long/url';
            const slug = await utils.createShortLink(longUrl);
            expect(slug).toBeDefined();
            expect(typeof slug).toBe('string');
            expect(slug.length).toBe(12); // 6 bytes = 12 hex characters
            expect(mockDb.collection).toHaveBeenCalledWith('shortlinks');
            expect(mockDb.doc).toHaveBeenCalledWith(slug);
            expect(mockDb.set).toHaveBeenCalledWith({
                url: longUrl,
                createdAt: expect.any(Date),
                clicks: 0,
            });
        });
        it('should throw error for invalid URL', async () => {
            await expect(utils.createShortLink('not-a-url')).rejects.toThrow('Invalid URL provided');
        });
        it('should accept valid URLs with different protocols', async () => {
            const urls = [
                'https://example.com',
                'http://example.com',
                'https://example.com/path?query=value',
            ];
            for (const url of urls) {
                await expect(utils.createShortLink(url)).resolves.toBeDefined();
            }
        });
    });
});
//# sourceMappingURL=utils.test.js.map