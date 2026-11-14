/**
 * Unit tests for the voice catalog service
 */

import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  canonicalVoiceId,
  getDefaultVoiceId,
  getGeminiVoice,
  getVoiceCatalog,
  getVoiceCatalogVersion,
  isGeminiVoiceId,
  isLegacyVoiceId,
  loadLegacyVoiceMap,
  resolveVoice,
} from "../voices";

const dir = mkdtempSync(join(tmpdir(), "voice-map-"));
const missingFile = join(dir, "missing.json");
const mapFile = join(dir, "map.json");
writeFileSync(mapFile, JSON.stringify({
  "Friendly_Person": { voice: "kore", style: "warm and friendly" },
  "Chinese (Mandarin)_News_Anchor": { voice: "Zephyr", languageCode: "cmn-CN" },
  "English_To_Arabic": { voice: "ar-001-advisor-1", languageCode: "en-US" },
  "No_Code_To_Arabic": { voice: "ar-001-advisor-1" },
  // A row that points at no Gemini voice is not usable.
  "Broken_Voice": { voice: "not-a-gemini-voice" },
  // A MiniMax ID never hides a Gemini ID.
  "puck": { voice: "kore" },
  "Not_A_Row": "kore",
}));

describe("voices", () => {
  const savedDefault = process.env.TTS_DEFAULT_VOICE_ID;

  beforeEach(() => {
    delete process.env.TTS_DEFAULT_VOICE_ID;
    loadLegacyVoiceMap([mapFile]);
  });

  afterAll(() => {
    if (savedDefault === undefined) delete process.env.TTS_DEFAULT_VOICE_ID;
    else process.env.TTS_DEFAULT_VOICE_ID = savedDefault;
  });

  describe("catalog", () => {
    it("should hold the Gemini voices with the fields the dashboard shows", () => {
      const catalog = getVoiceCatalog();
      expect(catalog.length).toBeGreaterThan(2000);
      expect(new Set(catalog.map((voice) => voice.id)).size).toBe(catalog.length);
      expect(getGeminiVoice("puck")).toEqual(expect.objectContaining({
        id: "puck", name: "Puck", studio: true, language: "en-US", gender: "male",
      }));
    });

    it("should give a short, stable version", () => {
      expect(getVoiceCatalogVersion()).toMatch(/^[0-9a-f]{12}$/);
      expect(getVoiceCatalogVersion()).toBe(getVoiceCatalogVersion());
    });
  });

  describe("isGeminiVoiceId", () => {
    it("should accept a catalog ID in any letter case", () => {
      expect(isGeminiVoiceId("puck")).toBe(true);
      expect(isGeminiVoiceId(" Puck ")).toBe(true);
      expect(isGeminiVoiceId("ar-001-advisor-1")).toBe(true);
    });

    it("should reject everything else", () => {
      expect(isGeminiVoiceId("Friendly_Person")).toBe(false);
      expect(isGeminiVoiceId("")).toBe(false);
      expect(isGeminiVoiceId(null)).toBe(false);
      expect(isGeminiVoiceId(5)).toBe(false);
      expect(isGeminiVoiceId("constructor")).toBe(false);
    });
  });

  describe("isLegacyVoiceId", () => {
    it("should accept a MiniMax ID of the map, in any letter case", () => {
      expect(isLegacyVoiceId("Friendly_Person")).toBe(true);
      expect(isLegacyVoiceId("friendly_person")).toBe(true);
      expect(isLegacyVoiceId("Chinese (Mandarin)_News_Anchor")).toBe(true);
    });

    it("should reject a Gemini ID, an unknown ID and a row with no Gemini voice", () => {
      expect(isLegacyVoiceId("puck")).toBe(false);
      expect(isLegacyVoiceId("Not_A_Real_Voice")).toBe(false);
      expect(isLegacyVoiceId("Broken_Voice")).toBe(false);
      expect(isLegacyVoiceId("Not_A_Row")).toBe(false);
      expect(isLegacyVoiceId(undefined)).toBe(false);
    });

    it("should reject every MiniMax ID when the map file is missing", () => {
      expect(loadLegacyVoiceMap([missingFile])).toBe(0);
      expect(isLegacyVoiceId("Friendly_Person")).toBe(false);
      expect(isGeminiVoiceId("puck")).toBe(true);
    });

    it("should treat a map file that is not JSON as missing", () => {
      const badFile = join(dir, "bad.json");
      writeFileSync(badFile, "{ not json");
      expect(loadLegacyVoiceMap([badFile])).toBe(0);
      expect(isLegacyVoiceId("Friendly_Person")).toBe(false);
    });

    it("should load the first file that exists", () => {
      expect(loadLegacyVoiceMap([missingFile, mapFile])).toBeGreaterThan(0);
      expect(isLegacyVoiceId("Friendly_Person")).toBe(true);
    });
  });

  describe("canonicalVoiceId", () => {
    it("should give a Gemini ID in its catalog spelling", () => {
      expect(canonicalVoiceId("PUCK")).toBe("puck");
    });

    it("should give a MiniMax ID as it was sent", () => {
      expect(canonicalVoiceId("Friendly_Person")).toBe("Friendly_Person");
    });

    it("should give null for an unknown ID", () => {
      expect(canonicalVoiceId("Not_A_Real_Voice")).toBeNull();
      expect(canonicalVoiceId(null)).toBeNull();
      expect(canonicalVoiceId({})).toBeNull();
    });
  });

  describe("resolveVoice", () => {
    it("should resolve a Gemini ID to itself", () => {
      expect(resolveVoice("Kore")).toEqual({ voice: "kore", voiceStyle: "", language: null, legacy: false, fallback: false });
    });

    it("should resolve a MiniMax ID through the map, with its manner", () => {
      expect(resolveVoice("Friendly_Person"))
          .toEqual({ voice: "kore", voiceStyle: "warm and friendly", language: null, legacy: true, fallback: false });
    });

    // The same rules as resolveVoice in voiceResolver.js of the bot.
    describe("language", () => {
      it("should give the language of a library voice that is not English", () => {
        expect(resolveVoice("ar-001-advisor-1").language).toBe("ar-001");
      });

      it("should give no language for an English library voice or a studio voice", () => {
        expect(resolveVoice("en-au-advisor-1").language).toBeNull();
        expect(resolveVoice("zephyr").language).toBeNull();
      });

      it("should give the language of the map row when a MiniMax voice maps to a studio voice", () => {
        expect(resolveVoice("Chinese (Mandarin)_News_Anchor"))
            .toEqual({ voice: "zephyr", voiceStyle: "", language: "cmn-CN", legacy: true, fallback: false });
      });

      it("should give the language of the target when the map row is English or has none", () => {
        expect(resolveVoice("English_To_Arabic").language).toBe("ar-001");
        expect(resolveVoice("No_Code_To_Arabic").language).toBe("ar-001");
        expect(resolveVoice("Friendly_Person").language).toBeNull();
      });
    });

    it("should prefer the Gemini voice when a MiniMax ID has the same name", () => {
      expect(resolveVoice("puck")).toEqual({ voice: "puck", voiceStyle: "", language: null, legacy: false, fallback: false });
    });

    it("should fall back to the default voice for anything else", () => {
      const fallback = { voice: "puck", voiceStyle: "", language: null, legacy: false, fallback: true };
      expect(resolveVoice("Not_A_Real_Voice")).toEqual(fallback);
      expect(resolveVoice("Broken_Voice")).toEqual(fallback);
      expect(resolveVoice(null)).toEqual(fallback);
      expect(resolveVoice(undefined)).toEqual(fallback);
    });

    it("should fall back for a MiniMax ID when the map file is missing", () => {
      loadLegacyVoiceMap([missingFile]);
      expect(resolveVoice("Friendly_Person"))
          .toEqual({ voice: "puck", voiceStyle: "", language: null, legacy: false, fallback: true });
    });
  });

  describe("getDefaultVoiceId", () => {
    it("should be puck unless TTS_DEFAULT_VOICE_ID is set", () => {
      expect(getDefaultVoiceId()).toBe("puck");
    });

    it("should use a Gemini ID from TTS_DEFAULT_VOICE_ID", () => {
      process.env.TTS_DEFAULT_VOICE_ID = "Kore";
      expect(getDefaultVoiceId()).toBe("kore");
      expect(resolveVoice("Not_A_Real_Voice").voice).toBe("kore");
    });

    it("should map a MiniMax ID from TTS_DEFAULT_VOICE_ID", () => {
      process.env.TTS_DEFAULT_VOICE_ID = "Chinese (Mandarin)_News_Anchor";
      expect(getDefaultVoiceId()).toBe("zephyr");
    });

    it("should be puck when TTS_DEFAULT_VOICE_ID is not a known voice", () => {
      process.env.TTS_DEFAULT_VOICE_ID = "Not_A_Real_Voice";
      expect(getDefaultVoiceId()).toBe("puck");
    });
  });
});
