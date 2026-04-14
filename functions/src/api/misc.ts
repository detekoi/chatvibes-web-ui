/**
 * Miscellaneous API routes (shortlinks, TTS test, etc.)
 */

import express, { Request, Response, Router } from "express";
import axios from "axios";
import { db, COLLECTIONS } from "../services/firestore";
import { createShortLink, normalizeEmotion } from "../services/utils";
import { authenticateApiRequest } from "../middleware/auth";
import { secrets, config } from "../config";
import { logger, redactSensitive } from "../logger";
import { RELEASED_VOICES } from "../services/voice-list";
import { getUserIdFromUsername } from "../services/twitch";

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

interface UserPreferences {
  voiceId?: string | null;
  emotion?: string | null;
  pitch?: number | null;
  speed?: number | null;
  languageBoost?: string | null;
}

interface ChannelDefaults {
  voiceId?: string | null;
  emotion?: string | null;
  pitch?: number | null;
  speed?: number | null;
  languageBoost?: string | null;
}

interface WavespeedInput {
  text: string;
  voice_id: string;
  speed: number;
  volume: number;
  pitch: number;
  emotion: string;
  language_boost: string;
  english_normalization: boolean;
  sample_rate: number;
  bitrate: number;
  channel: string;
  format: string;
  enable_sync_mode: boolean;
}

interface WavespeedResponse {
  status: string;
  outputs?: string[];
  error?: string;
  data?: {
    status: string;
    outputs?: string[];
    error?: string;
  };
}

// Route: /api/shortlink - Create a short link (requires app/viewer JWT)
apiRouter.post("/shortlink", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  const log = logger.child({ endpoint: "/api/shortlink" });
  try {
    const { url } = req.body;

    if (!url) {
      res.status(400).json({ error: "URL is required" });
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
    res.status(500).json({
      success: false,
      error: err.message,
    });
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



// Route: /api/voices - Get list of available voices
apiRouter.get("/voices", async (_req: Request, res: Response): Promise<void> => {
  res.json({
    success: true,
    voices: RELEASED_VOICES
  });
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
    res.status(400).json({ error: "Username is required", message: "Username is required", debug_params: req.params });
    return;
  }

  try {
    // 1. First, resolve username to Twitch User ID
    const userId = await getUserIdFromUsername(username, secrets);
    
    let docSnap;
    if (userId) {
      const docRef = db.collection(COLLECTIONS.TTS_USER_PREFS).doc(userId);
      docSnap = await docRef.get();
    }
    
    // 2. If not found by userId (or userId lookup failed), fallback to legacy username key
    if (!docSnap || !docSnap.exists) {
      const docRef = db.collection(COLLECTIONS.TTS_USER_PREFS).doc(username.toLowerCase());
      docSnap = await docRef.get();
    }

    if (docSnap && docSnap.exists) {
      const data = docSnap.data();
      res.json({
        success: true,
        username: username,
        voiceId: data?.voiceId || null,
        data: data // Return full data in case we want emotion/etc later
      });
    } else {
      res.json({
        success: true,
        username: username,
        voiceId: null,
        message: "User has no custom voice set"
      });
    }
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message }, "Error looking up user voice");
    res.status(500).json({
      success: false,
      error: "Failed to lookup user voice",
      message: err.message
    });
  }
});

// Route: /api/tts/test - Test TTS functionality
apiRouter.post("/tts/test", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { text, voiceId, emotion, pitch, speed, volume, languageBoost, channel } = req.body || {};
  const channelLogin = req.user.userLogin;
  const log = logger.child({ endpoint: "/api/tts/test", channelLogin, voiceId: voiceId || "default" });

  try {
    if (!text) {
      res.status(400).json({
        success: false,
        error: "Text is required for TTS test",
      });
      return;
    }

    log.info({ textLength: text.length }, "TTS test requested");

    // Resolve effective parameters in order: request override -> viewer global prefs -> channel defaults
    let effective: {
      voiceId: string | null;
      emotion: string | null;
      pitch: number | null;
      speed: number | null;
      volume: number | null;
      languageBoost: string | null;
    } = {
      voiceId: voiceId ?? null,
      emotion: normalizeEmotion(emotion),
      pitch: (pitch !== undefined) ? pitch : null,
      speed: (speed !== undefined) ? speed : null,
      volume: (volume !== undefined) ? volume : null,
      languageBoost: languageBoost ?? null,
    };

    try {
      // Load viewer global preferences
      const userDoc = await db.collection(COLLECTIONS.TTS_USER_PREFS).doc(channelLogin).get();
      const userPrefs: UserPreferences = userDoc.exists ? (userDoc.data() || {}) : {};

      // Optionally load channel defaults if a channel is provided
      let channelDefaults: ChannelDefaults = {};
      if (channel) {
        const channelDoc = await db.collection(COLLECTIONS.TTS_CHANNEL_CONFIGS).doc(channel).get();
        if (channelDoc.exists) {
          const d = channelDoc.data() || {};
          channelDefaults = {
            voiceId: d.voiceId ?? null,
            emotion: d.emotion ?? null,
            pitch: (d.pitch !== undefined) ? d.pitch : null,
            speed: (d.speed !== undefined) ? d.speed : null,
            languageBoost: d.languageBoost ?? null,
          };
        }
      }

      const pick = (reqVal: unknown, userVal: unknown, chanVal: unknown): unknown => {
        if (reqVal !== undefined && reqVal !== null && reqVal !== "") return reqVal; // explicit request
        if (userVal !== undefined && userVal !== null && userVal !== "") return userVal; // viewer global
        return (chanVal !== undefined && chanVal !== null && chanVal !== "") ? chanVal : null; // channel default
      };

      effective = {
        voiceId: pick(voiceId, userPrefs.voiceId, channelDefaults.voiceId) as string | null,
        emotion: normalizeEmotion(pick(emotion, userPrefs.emotion, channelDefaults.emotion) as string | null),
        pitch: pick(pitch, userPrefs.pitch, channelDefaults.pitch) as number | null,
        speed: pick(speed, userPrefs.speed, channelDefaults.speed) as number | null,
        volume: pick(volume, null, null) as number | null, // users/channel don't have simple volume field yet in this service
        languageBoost: pick(languageBoost, userPrefs.languageBoost, channelDefaults.languageBoost) as string | null,
      };
      log.debug({ effective }, "Effective params");
    } catch (resolveErr) {
      const err = resolveErr as Error;
      log.warn({ error: err.message }, "Failed to resolve defaults; proceeding with request values only");
    }

    // All voices use 302.ai (speech-2.8-turbo) as primary provider
    // Verified 2026-03-06: all 475 voices work on 302.ai
    const voice = effective.voiceId || "Friendly_Person";
    const use302 = !!secrets["302_KEY"];

    // Use 302.ai API
    if (use302) {
      try {
        log.debug("302.ai client initialized for TTS test");

        // Map language boost
        let languageBoostValue = effective.languageBoost || "auto";
        if (languageBoostValue === "Automatic" || languageBoostValue === "None") {
          languageBoostValue = "auto";
        }

        const input = {
          model: "speech-2.8-turbo",
          text,
          stream: false,
          voice_setting: {
            voice_id: voice,
            speed: typeof effective.speed === "number" ? effective.speed : 1.0,
            vol: typeof effective.volume === "number" ? effective.volume : 1.0,
            pitch: typeof effective.pitch === "number" ? effective.pitch : 0,
            emotion: effective.emotion || "neutral",
            text_normalization: false,
          },
          audio_setting: {
            sample_rate: 32000,
            bitrate: 128000,
            format: "mp3",
            channel: 1,
          },
          language_boost: languageBoostValue,
          output_format: "url",
        };

        const response = await axios.post(
          "https://api.302.ai/minimaxi/v1/t2a_v2",
          input,
          {
            headers: {
              "Authorization": `Bearer ${secrets["302_KEY"]}`,
              "Content-Type": "application/json",
            },
            timeout: 60000,
          }
        );

        const result = response.data;
        let audioUrl: string | undefined;

        if (result.data && result.data.url) {
          audioUrl = result.data.url;
        } else if (result.data && result.data.audio) {
          audioUrl = result.data.audio;
        } else if (result.url) {
          audioUrl = result.url;
        }

        if (audioUrl) {
          res.json({ success: true, audioUrl, provider: "302.ai", model: "speech-2.8-turbo" });
          return;
        } else {
          log.error({ result }, "302.ai returned unexpected response");
          // Fall through to Wavespeed? Or just error? Let's error for now as fallthrough might be confusing
          res.status(502).json({ success: false, error: "302.ai generated no audio URL" });
          return;
        }

      } catch (err302) {
        const error = err302 as any;
        log.error({ 
          error: error.message, 
          apiError: error.response?.data, 
          keyInfo: `Len: ${secrets["302_KEY"]?.length}, Start: ${secrets["302_KEY"]?.substring(0,4)}, End: ${secrets["302_KEY"]?.substring(secrets["302_KEY"]?.length - 4)}`,
        }, "302.ai call failed");
        // Could fallback to Wavespeed here if we wanted
        res.status(500).json({ success: false, error: "302.ai TTS generation failed" });
        return;
      }
    }

    // Fallback/Default: generate audio via Wavespeed AI (minimax/speech-02-turbo)
    if (secrets.WAVESPEED_API_KEY) {
      try {
        log.debug("Wavespeed AI client initialized for TTS test");

        // Map legacy language boost values to Wavespeed format
        let languageBoostValue = effective.languageBoost || "auto";
        if (languageBoostValue === "Automatic" || languageBoostValue === "None") {
          languageBoostValue = "auto";
        }

        const input: WavespeedInput & { vol: number } = {
          text,
          voice_id: voice,
          speed: typeof effective.speed === "number" ? effective.speed : 1.0,
          vol: typeof effective.volume === "number" ? effective.volume : 1.0,
          volume: typeof effective.volume === "number" ? effective.volume : 1.0,
          pitch: typeof effective.pitch === "number" ? effective.pitch : 0,
          emotion: effective.emotion || "neutral",
          language_boost: languageBoostValue,
          english_normalization: false,
          sample_rate: 32000,
          bitrate: 128000,
          channel: "1",
          format: "mp3",
          enable_sync_mode: true, // Enable sync mode for lowest latency
        };

        const response = await axios.post<WavespeedResponse>(
          "https://api.wavespeed.ai/api/v3/minimax/speech-02-turbo",
          input,
          {
            headers: {
              "Authorization": `Bearer ${secrets.WAVESPEED_API_KEY}`,
              "Content-Type": "application/json",
            },
            timeout: 60000, // 60 second timeout
          },
        );

        const result = response.data;
        const data = result.data || result;

        if (data.status === "completed" && data.outputs && data.outputs.length > 0) {
          const audioUrl = data.outputs[0];
          res.json({ success: true, audioUrl, provider: "wavespeed", model: "minimax/speech-02-turbo" });
          return;
        } else if (data.status === "failed") {
          log.error({ error: data.error }, "Wavespeed AI returned failed status");

          // Provide specific error messages based on the failure reason
          if (data.error && data.error.includes("you don't have access to this voice_id")) {
            res.status(403).json({
              success: false,
              error: `Voice access denied: The voice "${effective.voiceId}" requires special access permissions. Please try a different voice.`,
            });
            return;
          }

          if (data.error && data.error.includes("voice_id")) {
            res.status(400).json({
              success: false,
              error: `Invalid voice: "${effective.voiceId}" is not available. Please check the voice ID and try again.`,
            });
            return;
          }

          res.status(502).json({ success: false, error: `TTS generation failed: ${data.error || "Unknown error"}` });
          return;
        } else {
          log.warn({ data: redactSensitive(data) }, "Wavespeed AI returned unexpected status or missing outputs");
          res.status(502).json({ success: false, error: "No audio URL returned by TTS provider" });
          return;
        }
      } catch (wavespeedError) {
        const err = wavespeedError as { message: string; response?: { data?: { message?: string } } };
        log.error({
          error: err.message,
          responseData: redactSensitive(err?.response?.data),
        }, "Wavespeed AI call failed");

        // Provide specific error messages based on Wavespeed API response
        if (err.response?.data) {
          const apiError = err.response.data;

          // Check for specific Wavespeed error messages
          if (apiError.message && apiError.message.includes("you don't have access to this voice_id")) {
            res.status(403).json({
              success: false,
              error: `Voice access denied: The voice "${effective.voiceId}" requires special access permissions. Please try a different voice.`,
            });
            return;
          }

          if (apiError.message && apiError.message.includes("voice_id")) {
            res.status(400).json({
              success: false,
              error: `Invalid voice: "${effective.voiceId}" is not available. Please check the voice ID and try again.`,
            });
            return;
          }

          if (apiError.message) {
            res.status(502).json({
              success: false,
              error: `TTS generation failed: ${apiError.message}`,
            });
            return;
          }
        }

        // Fallback to generic error
        res.status(500).json({ success: false, error: "TTS generation failed" });
        return;
      }
    }

    // Fallback when Wavespeed AI is not configured
    res.status(501).json({ success: false, error: "TTS provider not configured" });
  } catch (error) {
    const err = error as Error;
    log.error({ error: err.message }, "Error in TTS test");
    res.status(500).json({
      success: false,
      error: "TTS test failed",
      message: err.message,
    });
  }
});

export {
  apiRouter,
  redirectRouter,
};
