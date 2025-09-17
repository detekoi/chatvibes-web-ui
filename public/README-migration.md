Global TTS User Preferences Migration

Run this once to migrate legacy per-channel viewer preferences into global collection `ttsUserPreferences`.

Steps:
- Authenticate: `gcloud auth application-default login`
- From `functions/` directory, run: `node migratePreferences.js`

Notes:
- Uses batch commits with a safety threshold.
- Last-write-wins if a user had preferences in multiple channels.
- Does not delete legacy data.


