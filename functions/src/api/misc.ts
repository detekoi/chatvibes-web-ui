/**
 * Miscellaneous API routes (shortlinks, TTS test, etc.)
 */

import { gzipSync } from "zlib";
import express, { Request, Response, Router } from "express";
import { db, COLLECTIONS } from "../services/firestore";
import { createShortLink, normalizeEmotion, validateEmotion } from "../services/utils";
import { authenticateApiRequest, assertAuthenticated } from "../middleware/auth";
import { ttsTestLimiter } from "../middleware/rateLimit";
import { secrets, config } from "../config";
import { logger } from "../logger";
import { getVoiceCatalog, getVoiceCatalogVersion, getDefaultVoiceId, resolveVoice } from "../services/voices";
import { buildStyle } from "../services/style";
import { generateSpeech, languageHint, getGeminiTtsModel, TtsBlockedError, TtsProviderError } from "../services/geminiTts";
import { getUserIdFromUsername } from "../services/twitch";
import { loadGlobalUserPreferences } from "../services/preferences";
import { apiError } from "./utils";

// Separate routers for API endpoints and public redirects
const apiRouter: Router = express.Router();
const redirectRouter: Router = express.Router();

// Type definitions
interface ShortlinkData {
  url: string;
  clicks?: number;
  createdAt?: Date;
  lastClickedAt?: Date;
}

// Route: /api/shortlink - Create a short link (requires app/viewer JWT)
apiRouter.post("/shortlink", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  const log = logger.child({ endpoint: "/api/shortlink" });
  try {
    const { url } = req.body;

    if (!url) {
      apiError(res, 400, "url_required", "URL is required");
      return;
    }

    const slug = await createShortLink(url);

    const pathOnly = `/s/${slug}`;
    const absoluteUrl = config.FRONTEND_URL ? `${new URL(config.FRONTEND_URL).origin}${pathOnly}` : pathOnly;
    res.json({
      success: true,
      slug: slug,
      shortUrl: pathOnly,
      absoluteUrl: absoluteUrl,
    });
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message }, "Error creating shortlink");
    apiError(res, 500, "shortlink_failed", err.message);
  }
});

// Route: /s/:slug - Redirect short link (public)
redirectRouter.get("/s/:slug", async (req: Request, res: Response): Promise<void> => {
  const { slug } = req.params;
  try {
    if (!slug) {
      res.status(400).send("Invalid short link");
      return;
    }

    const shortlinkDoc = await db.collection(COLLECTIONS.SHORTLINKS).doc(slug).get();

    if (!shortlinkDoc.exists) {
      res.status(404).send("Short link not found");
      return;
    }

    const data = shortlinkDoc.data() as ShortlinkData;
    const { url } = data;

    // Increment click counter
    try {
      await shortlinkDoc.ref.update({
        clicks: (data.clicks || 0) + 1,
        lastClickedAt: new Date(),
      });
    } catch (updateError) {
      const err = updateError as Error;
      logger.warn({ error: err.message, slug }, "Failed to update click counter");
    }

    logger.info({ slug, url }, "Redirecting short link");
    res.redirect(301, url);
  } catch (error) {
    const err = error as Error;
    logger.error({ error: err.message, slug }, "Error redirecting short link");
    res.status(500).send("Internal server error");
  }
});

// The catalog is about 0.9 MB of JSON and the app has no compression
// middleware, so the body is built and compressed one time for each instance.
let voicesBody: { json: Buffer; gzip: Buffer; etag: string } | null = null;

function getVoicesBody(): { json: Buffer; gzip: Buffer; etag: string } {
  if (!voicesBody) {
    const version = getVoiceCatalogVersion();
    const defaultVoiceId = getDefaultVoiceId();
    const json = Buffer.from(JSON.stringify({ success: true, version, defaultVoiceId, voices: getVoiceCatalog() }));
    voicesBody = { json, gzip: gzipSync(json), etag: `"${version}-${defaultVoiceId}"` };
  }
  return voicesBody;
}

// Route: /api/voices - The voice catalog (public)
apiRouter.get("/voices", (req: Request, res: Response): void => {
  const body = getVoicesBody();
  res.set("Cache-Control", "public, max-age=3600");
  res.set("ETag", body.etag);
  res.vary("Accept-Encoding");
  if (req.headers["if-none-match"] === body.etag) {
    res.status(304).end();
    return;
  }
  res.type("application/json");
  if (req.acceptsEncodings("gzip")) {
    res.set("Content-Encoding", "gzip");
    res.send(body.gzip);
    return;
  }
  res.send(body.json);
});

// Route: /api/tts/user-voice/:username - Lookup a user's custom voice ID
apiRouter.get("/tts/user-voice/:username", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  const { username } = req.params;
  const log = logger.child({
    endpoint: "/api/tts/user-voice",
    lookupUsername: username,
    requester: req.user?.userLogin,
    params: req.params,
    url: req.url,
    baseUrl: req.baseUrl
  });

  log.info("Processing user voice lookup");

  if (!username) {
    log.warn({ params: req.params }, "Username is required but missing from params");
    apiError(res, 400, "username_required", "Username is required", undefined, { message: "Username is required", debug_params: req.params });
    return;
  }

  try {
    // Preferences are keyed by Twitch user ID; the login is only how the caller names the user.
    const userId = await getUserIdFromUsername(username, secrets);
    const docSnap = userId ? await db.collection(COLLECTIONS.TTS_USER_PREFS).doc(userId).get() : null;

    // Only the voice. Any signed-in broadcaster can call this for any login, so
    // the rest of the document (the opt-out among it) is the viewer's business,
    // and the response must not change shape with what else the document holds.
    const stored: unknown = (docSnap?.exists && docSnap.data()?.voiceId) || null;
    const storedVoiceId: string | null = typeof stored === "string" ? stored : null;
    // The document can still hold a MiniMax ID. The caller gets the Gemini
    // voice that the bot speaks with, and the stored ID when the two differ.
    const voiceId = storedVoiceId ? resolveVoice(storedVoiceId).voice : null;
    res.json({
      success: true,
      username: username,
      voiceId,
      ...(storedVoiceId && storedVoiceId !== voiceId ? { storedVoiceId } : {}),
      ...(voiceId ? {} : { message: "User has no custom voice set" }),
    });
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message }, "Error looking up user voice");
    apiError(res, 500, "voice_lookup_failed", "Failed to lookup user voice", undefined, { message: err.message });
  }
});

// The highest volume a channel can store for a voice (see settings.ts).
const MAX_TEST_VOLUME = 10;

// Route: /api/tts/test - Test TTS functionality
// Authenticate first: ttsTestLimiter keys on req.user.userId and falls back to
// the (shared, proxied) IP when it is not set yet.
apiRouter.post("/tts/test", authenticateApiRequest, ttsTestLimiter, async (req: Request, res: Response): Promise<void> => {
  assertAuthenticated(req);

  const { text, voiceId, emotion, style, pitch, speed, volume, languageBoost } = req.body || {};
  const channelLogin = req.user.userLogin;
  const log = logger.child({ endpoint: "/api/tts/test", channelLogin, voiceId: voiceId || "default" });

  try {
    if (!text || typeof text !== "string") {
      apiError(res, 400, "tts_text_required", "Text is required for TTS test");
      return;
    }

    log.info({ textLength: text.length }, "TTS test requested");

    const given = (value: unknown): boolean => value !== undefined && value !== null && value !== "";

    // Resolve effective parameters in order: request override -> viewer global prefs
    let effective: {
      voiceId: string | null;
      voiceStyle: string | null;
      emotion: string | null;
      style: string | null;
      pitch: number | null;
      speed: number | null;
      volume: number | null;
      languageBoost: string | null;
    } = {
      voiceId: voiceId ?? null,
      voiceStyle: null,
      emotion: normalizeEmotion(emotion),
      style: given(style) ? style : null,
      pitch: (pitch !== undefined) ? pitch : null,
      speed: (speed !== undefined) ? speed : null,
      volume: (volume !== undefined) ? volume : null,
      languageBoost: languageBoost ?? null,
    };

    try {
      // Load viewer global preferences
      const userPrefs = await loadGlobalUserPreferences(req.user.userId);

      const pick = (reqVal: unknown, userVal: unknown): unknown => {
        if (given(reqVal)) return reqVal; // explicit request
        return given(userVal) ? userVal : null; // viewer global
      };

      effective = {
        voiceId: pick(voiceId, userPrefs.voiceId) as string | null,
        // The stored manner belongs to the stored voice, so a voice named in
        // the request does not take it.
        voiceStyle: given(voiceId) ? null : pick(null, userPrefs.voiceStyle) as string | null,
        emotion: normalizeEmotion(pick(emotion, userPrefs.emotion) as string | null),
        // A custom style replaces the emotion. An emotion named in the request
        // is the one to hear, so the stored style does not replace it.
        style: pick(style, given(emotion) ? null : userPrefs.style) as string | null,
        pitch: pick(pitch, userPrefs.pitch) as number | null,
        speed: pick(speed, userPrefs.speed) as number | null,
        volume: pick(volume, null) as number | null, // viewers have no volume preference
        languageBoost: pick(languageBoost, userPrefs.languageBoost) as string | null,
      };
      log.debug({ effective }, "Effective params");
    } catch (resolveErr) {
      const err = resolveErr as Error;
      log.warn({ error: err.message }, "Failed to resolve defaults; proceeding with request values only");
    }

    if (effective.emotion && !validateEmotion(effective.emotion)) {
      log.warn({ emotion: effective.emotion }, "Invalid emotion value, falling back to no emotion");
      effective.emotion = null;
    }

    if (!secrets.GEMINI_API_KEY) {
      apiError(res, 501, "tts_not_configured", "TTS provider not configured");
      return;
    }

    // A stored MiniMax ID maps to a Gemini voice plus the manner the map adds.
    const resolved = resolveVoice(effective.voiceId);
    const requestStyle = buildStyle({
      style: effective.style,
      voiceStyle: effective.voiceStyle ?? resolved.voiceStyle,
      emotion: effective.emotion,
      speed: effective.speed,
      pitch: effective.pitch,
    });
    const gain = typeof effective.volume === "number" && effective.volume > 0 ?
      Math.min(effective.volume, MAX_TEST_VOLUME) : 1;

    try {
      const { wav, model } = await generateSpeech({
        apiKey: secrets.GEMINI_API_KEY,
        text,
        voice: resolved.voice,
        style: requestStyle,
        language: languageHint(effective.languageBoost),
        volume: gain,
      });
      res.json({ success: true, audioBase64: wav.toString("base64"), mimeType: "audio/wav", provider: "gemini", model });
    } catch (ttsError) {
      const err = ttsError as Error;
      if (err instanceof TtsBlockedError) {
        log.info({ voice: resolved.voice }, "Gemini TTS refused the text");
        apiError(res, 400, "tts_blocked", "The voice service refused this text. Change the text and try again.");
        return;
      }
      const reason = err instanceof TtsProviderError ? err.reason : "unknown";
      log.error({ error: err.message, voice: resolved.voice, model: getGeminiTtsModel() }, "Gemini TTS call failed");
      if (reason === "no audio") {
        apiError(res, 502, "tts_no_audio", "No audio returned by TTS provider");
        return;
      }
      apiError(res, 502, "tts_generation_failed", `TTS generation failed: ${reason}`, { reason });
    }
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message }, "Error in TTS test");
    apiError(res, 500, "tts_test_failed", "TTS test failed", undefined, { message: err.message });
  }
});

export {
  apiRouter,
  redirectRouter,
};
