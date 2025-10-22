#!/usr/bin/env node

/**
 * Test script to verify Wavespeed API integration
 * Tests with a single voice to debug API issues
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const VOICES_DIR = join(__dirname, '..', 'public', 'assets', 'voices');
const WAVESPEED_API_KEY = process.env.WAVESPEED_API_KEY;
const WAVESPEED_API_URL = 'https://api.wavespeed.ai/api/v3/minimax/speech-02-turbo';

// Test with a simple English voice
const TEST_VOICE_ID = 'Friendly_Person';
const TEST_TEXT = "Hello world! This is a test of the text-to-speech system.";

// Default TTS settings
const DEFAULT_SETTINGS = {
    speed: 1.0,
    volume: 1,
    pitch: 0,
    emotion: "neutral",
    english_normalization: false,
    enable_sync_mode: false
};

/**
 * Submit TTS request to Wavespeed API
 */
async function submitTTSRequest(voiceId, text) {
    const payload = {
        text,
        voice_id: voiceId,
        ...DEFAULT_SETTINGS
    };

    console.log('📤 Sending request:', JSON.stringify(payload, null, 2));

    const response = await fetch(WAVESPEED_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${WAVESPEED_API_KEY}`
        },
        body: JSON.stringify(payload)
    });

    console.log('📥 Response status:', response.status);
    console.log('📥 Response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
        const errorText = await response.text();
        console.log('📥 Error response:', errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('📥 Response body:', JSON.stringify(result, null, 2));
    
    if (result.code === 200 && result.data && result.data.id) {
        return result.data.id;
    }
    
    throw new Error(`Unexpected response format: ${JSON.stringify(result)}`);
}

/**
 * Poll for TTS result
 */
async function pollForResult(requestId) {
    console.log(`🔍 Polling for result: ${requestId}`);
    
    const maxAttempts = 10;
    const pollInterval = 2000; // 2 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        console.log(`  Attempt ${attempt + 1}/${maxAttempts}...`);
        
        const response = await fetch(`https://api.wavespeed.ai/api/v3/predictions/${requestId}/result`, {
            headers: {
                'Authorization': `Bearer ${WAVESPEED_API_KEY}`
            }
        });

        console.log(`  Response status: ${response.status}`);

        if (!response.ok) {
            const errorText = await response.text();
            console.log(`  Error response: ${errorText}`);
            throw new Error(`Failed to get result: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        console.log(`  Response body:`, JSON.stringify(result, null, 2));

        if (result.code === 200 && result.data) {
            if (result.data.status === 'completed' && result.data.outputs && result.data.outputs.length > 0) {
                console.log(`  ✅ Audio data received (${result.data.outputs[0].length} chars)`);
                const audioData = Buffer.from(result.data.outputs[0], 'base64');
                return audioData;
            } else if (result.data.status === 'failed') {
                throw new Error(`TTS generation failed: ${result.data.error || 'Unknown error'}`);
            } else {
                console.log(`  Status: ${result.data.status}, waiting...`);
            }
        }

        // Still processing, wait and try again
        await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error('TTS generation timed out');
}

/**
 * Main test function
 */
async function main() {
    // Check API key
    if (!WAVESPEED_API_KEY) {
        console.error('❌ Error: WAVESPEED_API_KEY environment variable is required');
        process.exit(1);
    }

    // Ensure voices directory exists
    if (!existsSync(VOICES_DIR)) {
        mkdirSync(VOICES_DIR, { recursive: true });
        console.log(`📁 Created voices directory: ${VOICES_DIR}`);
    }

    console.log(`🧪 Testing Wavespeed API integration...`);
    console.log(`🎤 Voice: ${TEST_VOICE_ID}`);
    console.log(`📝 Text: ${TEST_TEXT}`);
    console.log('');

    try {
        // Submit TTS request
        const requestId = await submitTTSRequest(TEST_VOICE_ID, TEST_TEXT);
        console.log(`✅ Request submitted successfully: ${requestId}`);
        
        // Poll for result
        const audioData = await pollForResult(requestId);
        
        // Save test file
        const filename = `${TEST_VOICE_ID}-test.mp3`;
        writeFileSync(join(VOICES_DIR, filename), audioData);
        console.log(`✅ Test file saved: ${filename} (${audioData.length} bytes)`);
        
        console.log('');
        console.log('🎉 API test successful! The integration is working correctly.');
        
    } catch (error) {
        console.error('💥 Test failed:', error.message);
        process.exit(1);
    }
}

// Run the test
main().catch(error => {
    console.error('💥 Fatal error:', error.message);
    process.exit(1);
});
