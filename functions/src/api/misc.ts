/**
 * Miscellaneous API routes (shortlinks, TTS test, etc.)
 */

import express, {Request, Response, Router} from "express";
import axios from "axios";
import {db, COLLECTIONS} from "../services/firestore";
import {createShortLink, normalizeEmotion} from "../services/utils";
import {authenticateApiRequest} from "../middleware/auth";
import {secrets, config} from "../config";
import {logger, redactSensitive} from "../logger";

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
  const log = logger.child({endpoint: "/api/shortlink"});
  try {
    const {url} = req.body;

    if (!url) {
      res.status(400).json({error: "URL is required"});
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
    log.error({error: err.message}, "Error creating shortlink");
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// Route: /s/:slug - Redirect short link (public)
redirectRouter.get("/s/:slug", async (req: Request, res: Response): Promise<void> => {
  const {slug} = req.params;
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
    const {url} = data;

    // Increment click counter
    try {
      await shortlinkDoc.ref.update({
        clicks: (data.clicks || 0) + 1,
        lastClickedAt: new Date(),
      });
    } catch (updateError) {
      const err = updateError as Error;
      logger.warn({error: err.message, slug}, "Failed to update click counter");
    }

    logger.info({slug, url}, "Redirecting short link");
    res.redirect(301, url);
  } catch (error) {
    const err = error as Error;
    logger.error({error: err.message, slug}, "Error redirecting short link");
    res.status(500).send("Internal server error");
  }
});

// Route: /api/tts/test - Test TTS functionality
apiRouter.post("/tts/test", authenticateApiRequest, async (req: Request, res: Response): Promise<void> => {
  if (!req.user) {
    res.status(401).json({error: "Unauthorized"});
    return;
  }

  const {text, voiceId, emotion, pitch, speed, languageBoost, channel} = req.body || {};
  const channelLogin = req.user.userLogin;
  const log = logger.child({endpoint: "/api/tts/test", channelLogin, voiceId: voiceId || "default"});

  try {
    if (!text) {
      res.status(400).json({
        success: false,
        error: "Text is required for TTS test",
      });
      return;
    }

    log.info({textLength: text.length}, "TTS test requested");

    // Resolve effective parameters in order: request override -> viewer global prefs -> channel defaults
    let effective: {
      voiceId: string | null;
      emotion: string | null;
      pitch: number | null;
      speed: number | null;
      languageBoost: string | null;
    } = {voiceId: voiceId ?? null, emotion: normalizeEmotion(emotion), pitch: (pitch !== undefined) ? pitch : null, speed: (speed !== undefined) ? speed : null, languageBoost: languageBoost ?? null};

    try {
      // Load viewer global preferences
      const userDoc = await db.collection("ttsUserPreferences").doc(channelLogin).get();
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
        languageBoost: pick(languageBoost, userPrefs.languageBoost, channelDefaults.languageBoost) as string | null,
      };
      log.debug({effective}, "Effective params");
    } catch (resolveErr) {
      const err = resolveErr as Error;
      log.warn({error: err.message}, "Failed to resolve defaults; proceeding with request values only");
    }

    // If configured, generate audio via Wavespeed AI (minimax/speech-02-turbo)
    if (secrets.WAVESPEED_API_KEY) {
      try {
        log.debug("Wavespeed AI client initialized for TTS test");

        // Map legacy language boost values to Wavespeed format
        let languageBoostValue = effective.languageBoost || "auto";
        if (languageBoostValue === "Automatic" || languageBoostValue === "None") {
          languageBoostValue = "auto";
        }

        const input: WavespeedInput = {
          text,
          voice_id: effective.voiceId || "Friendly_Person",
          speed: typeof effective.speed === "number" ? effective.speed : 1.0,
          volume: 1.0,
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
          res.json({success: true, audioUrl, provider: "wavespeed", model: "minimax/speech-02-turbo"});
          return;
        } else if (data.status === "failed") {
          log.error({error: data.error}, "Wavespeed AI returned failed status");

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

          res.status(502).json({success: false, error: `TTS generation failed: ${data.error || "Unknown error"}`});
          return;
        } else {
          log.warn({data: redactSensitive(data)}, "Wavespeed AI returned unexpected status or missing outputs");
          res.status(502).json({success: false, error: "No audio URL returned by TTS provider"});
          return;
        }
      } catch (wavespeedError) {
        const err = wavespeedError as {message: string; response?: {data?: {message?: string}}};
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
        res.status(500).json({success: false, error: "TTS generation failed"});
        return;
      }
    }

    // Fallback when Wavespeed AI is not configured
    res.status(501).json({success: false, error: "TTS provider not configured"});
  } catch (error) {
    const err = error as Error;
    log.error({error: err.message}, "Error in TTS test");
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
