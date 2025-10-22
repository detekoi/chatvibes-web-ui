# Scripts Directory

This directory contains utility scripts for the ChatVibes Web UI project.

## Scripts

### `generate-voice-previews.js`
Main script for generating TTS audio files for voice previews using the Wavespeed API.

**Features:**
- Generates language-specific text for each voice
- Smart file skipping to avoid unnecessary API calls
- Rate limiting optimization (only delays when making API calls)
- Handles 400/403/429 errors gracefully
- Supports 30+ languages with native text

**Usage:**
```bash
# From project root
npm run generate-voices
# or
node scripts/generate-voice-previews.js
```

**Requirements:**
- `WAVESPEED_API_KEY` environment variable
- Node.js 18+ with fetch support

### `test-api.js`
Test script to verify Wavespeed API integration with a single voice.

**Usage:**
```bash
# From project root
npm run test-api
# or
node scripts/test-api.js
```

**Requirements:**
- `WAVESPEED_API_KEY` environment variable

## Environment Setup

Create a `.env` file in the project root:
```
WAVESPEED_API_KEY=your_api_key_here
```

## Output

Generated audio files are saved to `public/assets/voices/` with the naming convention:
- Dashboard: `{VoiceId}-welcome-everyone-to-the-stream.mp3`
- Viewer: `{VoiceId}-chat-is-this-real.mp3`
