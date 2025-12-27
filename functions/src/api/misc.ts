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
        volume: pick(volume, null, null) as number | null, // users/channel don't have simple volume field yet in this service
        languageBoost: pick(languageBoost, userPrefs.languageBoost, channelDefaults.languageBoost) as string | null,
      };
      log.debug({ effective }, "Effective params");
    } catch (resolveErr) {
      const err = resolveErr as Error;
      log.warn({ error: err.message }, "Failed to resolve defaults; proceeding with request values only");
    }

    // Determine provider based on voice ID
    const T302_SUPPORTED_VOICE_IDS = [
      "English_expressive_narrator", "English_radiant_girl", "English_magnetic_voiced_man",
      "English_compelling_lady1", "English_Aussie_Bloke", "English_captivating_female1",
      "English_Upbeat_Woman", "English_Trustworth_Man", "English_CalmWoman", "English_UpsetGirl",
      "English_Gentle-voiced_man", "English_Whispering_girl", "English_Diligent_Man",
      "English_Graceful_Lady", "English_ReservedYoungMan", "English_PlayfulGirl",
      "English_ManWithDeepVoice", "English_MaturePartner", "English_FriendlyPerson",
      "English_MatureBoss", "English_Debator", "English_LovelyGirl", "English_Steadymentor",
      "English_Deep-VoicedGentleman", "English_Wiselady", "English_CaptivatingStoryteller",
      "English_DecentYoungMan", "English_SentimentalLady", "English_ImposingManner",
      "English_SadTeen", "English_PassionateWarrior", "English_WiseScholar",
      "English_Soft-spokenGirl", "English_SereneWoman", "English_ConfidentWoman",
      "English_PatientMan", "English_Comedian", "English_BossyLeader", "English_Strong-WilledBoy",
      "English_StressedLady", "English_AssertiveQueen", "English_AnimeCharacter",
      "English_Jovialman", "English_WhimsicalGirl", "English_Kind-heartedGirl",
      "Chinese (Mandarin)_Reliable_Executive", "Chinese (Mandarin)_News_Anchor",
      "Chinese (Mandarin)_Unrestrained_Young_Man", "Chinese (Mandarin)_Mature_Woman",
      "Arrogant_Miss", "Robot_Armor", "Chinese (Mandarin)_Kind-hearted_Antie",
      "Chinese (Mandarin)_HK_Flight_Attendant", "Chinese (Mandarin)_Humorous_Elder",
      "Chinese (Mandarin)_Gentleman", "Chinese (Mandarin)_Warm_Bestie",
      "Chinese (Mandarin)_Stubborn_Friend", "Chinese (Mandarin)_Sweet_Lady",
      "Chinese (Mandarin)_Southern_Young_Man", "Chinese (Mandarin)_Wise_Women",
      "Chinese (Mandarin)_Gentle_Youth", "Chinese (Mandarin)_Warm_Girl",
      "Chinese (Mandarin)_Male_Announcer", "Chinese (Mandarin)_Kind-hearted_Elder",
      "Chinese (Mandarin)_Cute_Spirit", "Chinese (Mandarin)_Radio_Host",
      "Chinese (Mandarin)_Lyrical_Voice", "Chinese (Mandarin)_Straightforward_Boy",
      "Chinese (Mandarin)_Sincere_Adult", "Chinese (Mandarin)_Gentle_Senior",
      "Chinese (Mandarin)_Crisp_Girl", "Chinese (Mandarin)_Pure-hearted_Boy",
      "Chinese (Mandarin)_Soft_Girl", "Chinese (Mandarin)_IntellectualGirl",
      "Chinese (Mandarin)_Warm_HeartedGirl", "Chinese (Mandarin)_Laid_BackGirl",
      "Chinese (Mandarin)_ExplorativeGirl", "Chinese (Mandarin)_Warm-HeartedAunt",
      "Chinese (Mandarin)_BashfulGirl",
      "Japanese_IntellectualSenior", "Japanese_DecisivePrincess", "Japanese_LoyalKnight",
      "Japanese_DominantMan", "Japanese_SeriousCommander", "Japanese_ColdQueen",
      "Japanese_DependableWoman", "Japanese_GentleButler", "Japanese_KindLady",
      "Japanese_CalmLady", "Japanese_OptimisticYouth", "Japanese_GenerousIzakayaOwner",
      "Japanese_SportyStudent", "Japanese_InnocentBoy", "Japanese_GracefulMaiden",
      "Cantonese_ProfessionalHost (F)", "Cantonese_ProfessionalHost（F)", "Cantonese_GentleLady",
      "Cantonese_ProfessionalHost (M)", "Cantonese_ProfessionalHost（M)",
      "Cantonese_PlayfulMan", "Cantonese_CuteGirl", "Cantonese_KindWoman",
      "Korean_AirheadedGirl", "Korean_AthleticGirl", "Korean_AthleticStudent",
      "Korean_BraveAdventurer", "Korean_BraveFemaleWarrior", "Korean_BraveYouth",
      "Korean_CalmGentleman", "Korean_CalmLady", "Korean_CaringWoman",
      "Korean_CharmingElderSister", "Korean_CharmingSister", "Korean_CheerfulBoyfriend",
      "Korean_CheerfulCoolJunior", "Korean_CheerfulLittleSister", "Korean_ChildhoodFriendGirl",
      "Korean_CockyGuy", "Korean_ColdGirl", "Korean_ColdYoungMan", "Korean_ConfidentBoss",
      "Korean_ConsiderateSenior", "Korean_DecisiveQueen", "Korean_DominantMan",
      "Korean_ElegantPrincess", "Korean_EnchantingSister", "Korean_EnthusiasticTeen",
      "Korean_FriendlyBigSister", "Korean_GentleBoss", "Korean_GentleWoman",
      "Korean_HaughtyLady", "Korean_InnocentBoy", "Korean_IntellectualMan",
      "Korean_IntellectualSenior", "Korean_LonelyWarrior", "Korean_MatureLady",
      "Korean_MysteriousGirl", "Korean_OptimisticYouth", "Korean_PlayboyCharmer",
      "Korean_PossessiveMan", "Korean_QuirkyGirl", "Korean_ReliableSister",
      "Korean_ReliableYouth", "Korean_SassyGirl", "Korean_ShyGirl", "Korean_SoothingLady",
      "Korean_StrictBoss", "Korean_SweetGirl", "Korean_ThoughtfulWoman", "Korean_WiseElf",
      "Korean_WiseTeacher",
      "Spanish_SereneWoman", "Spanish_MaturePartner", "Spanish_CaptivatingStoryteller",
      "Spanish_Narrator", "Spanish_WiseScholar", "Spanish_Kind-heartedGirl",
      "Spanish_DeterminedManager", "Spanish_BossyLeader", "Spanish_ReservedYoungMan",
      "Spanish_ConfidentWoman", "Spanish_ThoughtfulMan", "Spanish_Strong-WilledBoy",
      "Spanish_SophisticatedLady", "Spanish_RationalMan", "Spanish_AnimeCharacter",
      "Spanish_Deep-tonedMan", "Spanish_Fussyhostess", "Spanish_SincereTeen",
      "Spanish_FrankLady", "Spanish_Comedian", "Spanish_Debator", "Spanish_ToughBoss",
      "Spanish_Wiselady", "Spanish_Steadymentor", "Spanish_Jovialman", "Spanish_SantaClaus",
      "Spanish_Rudolph", "Spanish_Intonategirl", "Spanish_Arnold", "Spanish_Ghost",
      "Spanish_HumorousElder", "Spanish_EnergeticBoy", "Spanish_WhimsicalGirl",
      "Spanish_StrictBoss", "Spanish_ReliableMan", "Spanish_SereneElder", "Spanish_AngryMan",
      "Spanish_AssertiveQueen", "Spanish_CaringGirlfriend", "Spanish_PowerfulSoldier",
      "Spanish_PassionateWarrior", "Spanish_ChattyGirl", "Spanish_RomanticHusband",
      "Spanish_CompellingGirl", "Spanish_PowerfulVeteran", "Spanish_SensibleManager",
      "Spanish_ThoughtfulLady",
      "Portuguese_SentimentalLady", "Portuguese_BossyLeader", "Portuguese_Wiselady",
      "Portuguese_Strong-WilledBoy", "Portuguese_Deep-VoicedGentleman", "Portuguese_UpsetGirl",
      "Portuguese_PassionateWarrior", "Portuguese_AnimeCharacter", "Portuguese_ConfidentWoman",
      "Portuguese_AngryMan", "Portuguese_CaptivatingStoryteller", "Portuguese_Godfather",
      "Portuguese_ReservedYoungMan", "Portuguese_SmartYoungGirl", "Portuguese_Kind-heartedGirl",
      "Portuguese_Pompouslady", "Portuguese_Grinch", "Portuguese_Debator", "Portuguese_SweetGirl",
      "Portuguese_AttractiveGirl", "Portuguese_ThoughtfulMan", "Portuguese_PlayfulGirl",
      "Portuguese_GorgeousLady", "Portuguese_LovelyLady", "Portuguese_SereneWoman",
      "Portuguese_SadTeen", "Portuguese_MaturePartner", "Portuguese_Comedian",
      "Portuguese_NaughtySchoolgirl", "Portuguese_Narrator", "Portuguese_ToughBoss",
      "Portuguese_Fussyhostess", "Portuguese_Dramatist", "Portuguese_Steadymentor",
      "Portuguese_Jovialman", "Portuguese_CharmingQueen", "Portuguese_SantaClaus",
      "Portuguese_Rudolph", "Portuguese_Arnold", "Portuguese_CharmingSanta",
      "Portuguese_CharmingLady", "Portuguese_Ghost", "Portuguese_HumorousElder",
      "Portuguese_CalmLeader", "Portuguese_GentleTeacher", "Portuguese_EnergeticBoy",
      "Portuguese_ReliableMan", "Portuguese_SereneElder", "Portuguese_GrimReaper",
      "Portuguese_AssertiveQueen", "Portuguese_WhimsicalGirl", "Portuguese_StressedLady",
      "Portuguese_FriendlyNeighbor", "Portuguese_CaringGirlfriend", "Portuguese_PowerfulSoldier",
      "Portuguese_FascinatingBoy", "Portuguese_RomanticHusband", "Portuguese_StrictBoss",
      "Portuguese_InspiringLady", "Portuguese_PlayfulSpirit", "Portuguese_ElegantGirl",
      "Portuguese_CompellingGirl", "Portuguese_PowerfulVeteran", "Portuguese_SensibleManager",
      "Portuguese_ThoughtfulLady", "Portuguese_TheatricalActor", "Portuguese_FragileBoy",
      "Portuguese_ChattyGirl", "Portuguese_Conscientiousinstructor", "Portuguese_RationalMan",
      "Portuguese_WiseScholar", "Portuguese_FrankLady", "Portuguese_DeterminedManager",
      "French_Male_Speech_New", "French_Female_News Anchor", "French_CasualMan",
      "French_MovieLeadFemale", "French_FemaleAnchor", "French_MaleNarrator",
      "Indonesian_SweetGirl", "Indonesian_ReservedYoungMan", "Indonesian_CharmingGirl",
      "Indonesian_CalmWoman", "Indonesian_ConfidentWoman", "Indonesian_CaringMan",
      "Indonesian_BossyLeader", "Indonesian_DeterminedBoy", "Indonesian_GentleGirl",
      "German_FriendlyMan", "German_SweetLady", "German_PlayfulMan",
      "Russian_HandsomeChildhoodFriend", "Russian_BrightHeroine", "Russian_AmbitiousWoman",
      "Russian_ReliableMan", "Russian_CrazyQueen", "Russian_PessimisticGirl",
      "Russian_AttractiveGuy", "Russian_Bad-temperedBoy",
      "Italian_BraveHeroine", "Italian_Narrator", "Italian_WanderingSorcerer",
      "Italian_DiligentLeader",
      "Dutch_kindhearted_girl", "Dutch_bossy_leader",
      "Vietnamese_kindhearted_girl",
      "Arabic_CalmWoman", "Arabic_FriendlyGuy",
      "Turkish_CalmWoman", "Turkish_Trustworthyman",
      "Ukrainian_CalmWoman", "Ukrainian_WiseScholar",
      "Thai_male_1_sample8", "Thai_male_2_sample2", "Thai_female_1_sample1", "Thai_female_2_sample2",
      "Polish_male_1_sample4", "Polish_male_2_sample3", "Polish_female_1_sample1", "Polish_female_2_sample3",
      "Romanian_male_1_sample2", "Romanian_male_2_sample1", "Romanian_female_1_sample4", "Romanian_female_2_sample1",
      "greek_male_1a_v1", "Greek_female_1_sample1", "Greek_female_2_sample3",
      "czech_male_1_v1", "czech_female_5_v7", "czech_female_2_v2",
      "finnish_male_3_v1", "finnish_male_1_v2", "finnish_female_4_v1",
      "hindi_male_1_v2", "hindi_female_2_v1", "hindi_female_1_v2"
    ];

    const voice = effective.voiceId || "Friendly_Person";
    const use302 = T302_SUPPORTED_VOICE_IDS.includes(voice) && !!secrets["302_KEY"];

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
          model: "speech-2.6-turbo",
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
          res.json({ success: true, audioUrl, provider: "302.ai", model: "speech-2.6-turbo" });
          return;
        } else {
          log.error({ result }, "302.ai returned unexpected response");
          // Fall through to Wavespeed? Or just error? Let's error for now as fallthrough might be confusing
          res.status(502).json({ success: false, error: "302.ai generated no audio URL" });
          return;
        }

      } catch (err302) {
        const error = err302 as Error;
        log.error({ error: error.message }, "302.ai call failed");
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
