/**
 * Test helpers for API integration tests
 */
import * as admin from 'firebase-admin';
export declare const TEST_JWT_SECRET: string;
/**
 * Create a JWT token for testing authenticated requests
 */
export declare function createTestToken(payload: {
    userId: string;
    userLogin: string;
    displayName?: string;
    scope?: string;
}): string;
/**
 * Create test user data
 */
export declare function createTestUser(login?: string): {
    userId: string;
    userLogin: string;
    displayName: string;
};
/**
 * Get Firestore instance for testing
 */
export declare function getTestDb(): admin.firestore.Firestore;
/**
 * Clear Firestore test data
 * Note: This requires the Firebase Emulator to be running
 */
export declare function clearTestData(): Promise<void>;
/**
 * Set environment variables for testing
 */
export declare function setupTestEnv(): void;
//# sourceMappingURL=testHelpers.d.ts.map