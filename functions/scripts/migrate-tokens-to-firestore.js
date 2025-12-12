#!/usr/bin/env node
/**
 * Migrate user OAuth tokens from Secret Manager to Firestore
 *
 * This script:
 * 1. Reads all twitch-access-token-* and twitch-refresh-token-* secrets
 * 2. Stores them in Firestore under users/{userId}/private/oauth
 * 3. Optionally deletes the secrets from Secret Manager
 *
 * Run with --execute to actually perform the migration
 * Run with --cleanup to also delete secrets after migration
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import admin from 'firebase-admin';

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'chatvibestts';
const EXECUTE = process.argv.includes('--execute');
const CLEANUP = process.argv.includes('--cleanup');

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: PROJECT_ID,
    });
}

const db = admin.firestore();
const secretClient = new SecretManagerServiceClient();

/**
 * Extract user ID from secret name (e.g., "twitch-access-token-123456" -> "123456")
 */
function extractUserId(secretName) {
    const match = secretName.match(/twitch-(access|refresh)-token-(\d+)$/);
    return match ? match[2] : null;
}

/**
 * Get token type from secret name
 */
function getTokenType(secretName) {
    if (secretName.includes('access-token')) return 'access';
    if (secretName.includes('refresh-token')) return 'refresh';
    return null;
}

/**
 * Migrate tokens for a single user
 */
async function migrateUserTokens(userId, tokens) {
    const userRef = db.collection('users').doc(userId);
    const privateRef = userRef.collection('private').doc('oauth');

    console.log(`\n👤 User ${userId}:`);
    console.log(`   Access token: ${tokens.access ? '✓' : '✗'}`);
    console.log(`   Refresh token: ${tokens.refresh ? '✓' : '✗'}`);

    if (!EXECUTE) {
        console.log(`   [DRY RUN] Would store in Firestore: users/${userId}/private/oauth`);
        return;
    }

    // Store tokens in Firestore
    await privateRef.set({
        twitchAccessToken: tokens.access || null,
        twitchRefreshToken: tokens.refresh || null,
        migratedAt: admin.firestore.FieldValue.serverTimestamp(),
        migratedFrom: 'secret-manager',
    }, { merge: true });

    console.log(`   ✅ Migrated to Firestore`);
}

/**
 * Delete a secret from Secret Manager
 */
async function deleteSecret(secretName) {
    if (!EXECUTE || !CLEANUP) {
        console.log(`   [DRY RUN] Would delete secret: ${secretName}`);
        return;
    }

    try {
        await secretClient.deleteSecret({
            name: `projects/${PROJECT_ID}/secrets/${secretName}`,
        });
        console.log(`   🗑️  Deleted secret: ${secretName}`);
    } catch (error) {
        console.error(`   ❌ Failed to delete ${secretName}:`, error.message);
    }
}

/**
 * Main migration function
 */
async function migrateTokens() {
    console.log('🔄 User OAuth Token Migration: Secret Manager → Firestore');
    console.log('========================================================');
    console.log(`Project: ${PROJECT_ID}`);
    console.log(`Mode: ${EXECUTE ? '🔴 EXECUTE' : '🟡 DRY RUN (use --execute to run)'}`);
    console.log(`Cleanup: ${CLEANUP ? '🔴 ENABLED (will delete secrets)' : '🟢 DISABLED'}`);
    console.log('');

    if (!EXECUTE) {
        console.log('⚠️  DRY RUN MODE - No changes will be made');
        console.log('   Run with --execute flag to actually migrate\n');
    }

    // List all secrets
    const [secrets] = await secretClient.listSecrets({
        parent: `projects/${PROJECT_ID}`,
    });

    // Group tokens by user ID
    const userTokens = new Map();
    const secretsToDelete = [];

    for (const secret of secrets) {
        const secretName = secret.name.split('/').pop();
        const userId = extractUserId(secretName);
        const tokenType = getTokenType(secretName);

        if (!userId || !tokenType) continue;

        // Get latest version of the secret
        try {
            const [version] = await secretClient.accessSecretVersion({
                name: `${secret.name}/versions/latest`,
            });
            const tokenValue = version.payload?.data?.toString().trim();

            if (!userTokens.has(userId)) {
                userTokens.set(userId, {});
            }
            userTokens.get(userId)[tokenType] = tokenValue;
            secretsToDelete.push(secretName);
        } catch (error) {
            console.error(`Failed to read ${secretName}:`, error.message);
        }
    }

    console.log(`Found ${userTokens.size} users with OAuth tokens in Secret Manager\n`);

    // Migrate each user's tokens
    for (const [userId, tokens] of userTokens) {
        await migrateUserTokens(userId, tokens);
    }

    // Delete secrets if cleanup is enabled
    if (CLEANUP && secretsToDelete.length > 0) {
        console.log(`\n🗑️  Cleaning up ${secretsToDelete.length} secrets from Secret Manager...`);
        for (const secretName of secretsToDelete) {
            await deleteSecret(secretName);
        }
    }

    // Summary
    console.log('\n📊 Migration Summary');
    console.log('===================');
    console.log(`Users migrated: ${userTokens.size}`);
    console.log(`Secrets ${CLEANUP && EXECUTE ? 'deleted' : 'to delete'}: ${secretsToDelete.length}`);

    if (!EXECUTE) {
        console.log('\n⚠️  This was a dry run. Run with --execute to perform the migration.');
    } else {
        console.log('\n✅ Migration complete!');
        if (!CLEANUP) {
            console.log('💡 Run with --cleanup flag to also delete secrets from Secret Manager');
        }
    }

    // Estimated cost savings
    const currentMonthlyCost = secretsToDelete.length * 2 * 0.06; // 2 versions per secret on average
    const apiCallReduction = userTokens.size * 4 * 30 * 24; // ~4 calls per user per hour
    console.log(`\n💰 Estimated Savings:`);
    console.log(`   Storage: ~$${currentMonthlyCost.toFixed(2)}/month (${secretsToDelete.length} secrets)`);
    console.log(`   API calls: ~${(apiCallReduction / 1000).toFixed(0)}K calls/month reduced`);
}

// Run migration
migrateTokens().catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
});
