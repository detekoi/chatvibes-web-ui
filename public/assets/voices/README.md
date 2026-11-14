# Voice samples

This directory holds the audio samples that the voice picker plays. The voice picker is the list of voices on the dashboard and on the viewer settings page.

## Gemini samples

The directory `gemini/` holds one MP3 file for each voice in the Gemini voice catalog. The catalog is the file `functions/src/services/gemini-voices.json`.

- File name: `gemini/<voice id>.mp3`, for example `gemini/puck.mp3`.
- Phrase: each voice says "Chat, is this real?" in its own language. An English voice and a studio voice say the English phrase. A studio voice is one of the 30 voices that speak every language. The phrases are in `scripts/voice-sample-phrases.json` in the bot repository (`../tts-twitch`).
- Format: MP3, mono, 24 kHz, 48 kbit/s.

When the reader presses the play button of a voice, the page loads the sample of that voice. If the file is missing, the page shows this message: "No sample is available for this voice."

The "Send preview" button does not use these files. It sends the text and the current settings to `POST /api/tts/test`, and the server returns new audio.

## Add samples for new voices

The bot repository renders the samples, because it owns the voice catalog and the phrases. The script skips each voice that already has a clip.

1. In `../tts-twitch`, run `node --env-file=.env scripts/sync-gemini-voices.js` to download the new catalog.
2. If the catalog has a new language, add its phrase to `scripts/voice-sample-phrases.json`.
3. Make sure that `ffmpeg` is installed and on the PATH.
4. In `../tts-twitch`, run this command:

   ```bash
   node --env-file=.env scripts/generate-gemini-voice-samples.js --native --mp3=../chatvibes-web-ui/public/assets/voices/gemini
   ```

5. If the script reports failures, run the same command again. The script renders only the clips that are missing.
6. In `../tts-twitch`, run `npm run sync-constants` to copy the catalog to this repository.

## Old MiniMax files

The MP3 files directly in this directory are from the MiniMax voices. Their names end with `-welcome-everyone-to-the-stream.mp3` or `-chat-is-this-real.mp3`. The pages do not load these files. Firebase Hosting does not deploy them: `firebase.json` lists `assets/voices/*.mp3` under `hosting.ignore`.
