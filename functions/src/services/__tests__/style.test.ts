/**
 * Unit tests for the style builder. The expected values are the ones that
 * src/components/tts/styleBuilder.js in the tts-twitch repo gives.
 */

import * as ttsConfig from "../tts-config.json";
import {
  buildStyle,
  pitchStep,
  sanitizeStyle,
  SOUND_TAG_NAMES,
  speedStep,
  STYLE_MAX_LENGTH,
  validateDisabledSoundTags,
  validateStyle,
} from "../style";

describe("style", () => {
  describe("speedStep", () => {
    it.each([
      [0.5, "very_slow"],
      [0.65, "very_slow"],
      [0.66, "slow"],
      [0.9, "slow"],
      [1, "normal"],
      [1.15, "normal"],
      [1.2, "fast"],
      [1.7, "fast"],
      [1.71, "very_fast"],
      [2, "very_fast"],
    ])("should put speed %p in step %s", (speed, key) => {
      expect(speedStep(speed)?.key).toBe(key);
    });

    it.each([[undefined], [null], [""], ["fast"], [NaN], [{}]])("should use the normal step for %p", (speed) => {
      expect(speedStep(speed)?.key).toBe("normal");
    });

    // A speed of 0 or less is not a stored value. Without the guard it was "very slow".
    it.each([[0], ["0"], [-1], [false], ["   "]])("should use the normal step for %p, which is not a speed", (speed) => {
      expect(speedStep(speed)?.key).toBe("normal");
    });
  });

  describe("pitchStep", () => {
    it.each([
      [-12, "very_low"],
      [-7, "very_low"],
      [-6, "low"],
      [-2, "low"],
      [-1, "normal"],
      [0, "normal"],
      [1, "normal"],
      [2, "high"],
      [6, "high"],
      [7, "very_high"],
      [12, "very_high"],
    ])("should put pitch %p in step %s", (pitch, key) => {
      expect(pitchStep(pitch)?.key).toBe(key);
    });

    it("should use the normal step for a value that is not a number", () => {
      expect(pitchStep(undefined)?.key).toBe("normal");
    });
  });

  describe("sanitizeStyle", () => {
    it("should keep a plain style", () => {
      expect(sanitizeStyle("like a tired pirate")).toBe("like a tired pirate");
    });

    it("should remove control characters and brackets, and join the lines", () => {
      expect(sanitizeStyle("  calm\r\n<and>\t{slow}\u0000\u007f  ")).toBe("calm and slow");
    });

    it("should cut a long style at the maximum length", () => {
      expect(sanitizeStyle("a".repeat(500))).toBe("a".repeat(STYLE_MAX_LENGTH));
      expect(sanitizeStyle(`${"a".repeat(STYLE_MAX_LENGTH - 1)} b`)).toBe("a".repeat(STYLE_MAX_LENGTH - 1));
    });

    it.each([[undefined], [null], [5], [["calm"]], [""], ["   "], ["<>{}"]])("should give \"\" for %p", (value) => {
      expect(sanitizeStyle(value)).toBe("");
    });
  });

  describe("validateStyle", () => {
    it("should give the clean style", () => {
      expect(validateStyle("  like a\n<tired> pirate ")).toEqual({ ok: true, value: "like a tired pirate" });
    });

    it("should accept an empty style, which clears the setting", () => {
      expect(validateStyle("")).toEqual({ ok: true, value: "" });
      expect(validateStyle("  \n ")).toEqual({ ok: true, value: "" });
    });

    it("should accept a style of the maximum length", () => {
      expect(validateStyle("a".repeat(STYLE_MAX_LENGTH))).toEqual({ ok: true, value: "a".repeat(STYLE_MAX_LENGTH) });
    });

    it("should measure the length after the cleanup", () => {
      expect(validateStyle(`  ${"a".repeat(STYLE_MAX_LENGTH)}  `).ok).toBe(true);
    });

    it("should refuse a style that is too long, with a code and the limit", () => {
      expect(validateStyle("a".repeat(STYLE_MAX_LENGTH + 1))).toEqual({
        ok: false, reasonCode: "style_too_long", reasonParams: { max: 120 },
      });
    });

    it.each([[undefined], [null], [5], [["calm"]]])("should refuse %p", (value) => {
      expect(validateStyle(value)).toEqual({ ok: false, reasonCode: "style_invalid" });
    });
  });

  describe("buildStyle", () => {
    it("should give \"\" when the clip needs no style", () => {
      expect(buildStyle()).toBe("");
      expect(buildStyle({})).toBe("");
      expect(buildStyle({ emotion: "neutral", speed: 1, pitch: 0 })).toBe("");
      expect(buildStyle({ emotion: "auto" })).toBe("");
      expect(buildStyle({ emotion: null, speed: null, pitch: null })).toBe("");
    });

    it.each(Object.entries(ttsConfig.STYLE_PRESETS))("should use the preset of the emotion %s", (emotion, preset) => {
      expect(buildStyle({ emotion })).toBe(preset);
    });

    it("should put the emotion first, then the pace, then the pitch", () => {
      expect(buildStyle({ emotion: "happy", speed: 1.5, pitch: -5 })).toBe("happy and cheerful, speaking quickly, low pitch");
      expect(buildStyle({ speed: 0.5, pitch: 12 })).toBe("speaking very slowly, very high pitch");
      expect(buildStyle({ speed: 2, pitch: -12 })).toBe("speaking very rapidly, very low pitch, deep voice");
    });

    it("should let a custom style replace the emotion preset", () => {
      expect(buildStyle({ style: "like a tired pirate", emotion: "happy", speed: 0.75 })).toBe("like a tired pirate, speaking slowly");
    });

    it("should use the emotion when the custom style has nothing usable", () => {
      expect(buildStyle({ style: " <> ", emotion: "sad" })).toBe("sad and downcast");
    });

    it("should put the manner of a mapped voice first", () => {
      expect(buildStyle({ voiceStyle: "warm and friendly", style: "whispering", pitch: 5 })).toBe("warm and friendly, whispering, high pitch");
      expect(buildStyle({ voiceStyle: "warm and friendly", emotion: "calm" })).toBe("warm and friendly, calm and relaxed");
    });

    it("should ignore an emotion that has no preset", () => {
      expect(buildStyle({ emotion: "ecstatic" })).toBe("");
      expect(buildStyle({ emotion: "constructor" })).toBe("");
      expect(buildStyle({ emotion: 5 })).toBe("");
    });

    it("should accept the numbers as strings, as the bot does", () => {
      expect(buildStyle({ speed: "1.5", pitch: "-5" })).toBe("speaking quickly, low pitch");
    });
  });

  describe("validateDisabledSoundTags", () => {
    it("should know the tags of tts-config.json", () => {
      expect(SOUND_TAG_NAMES).toEqual(ttsConfig.SOUND_TAGS.map((entry) => entry.tag));
      expect(SOUND_TAG_NAMES).toContain("laugh");
    });

    it("should accept an empty list", () => {
      expect(validateDisabledSoundTags([])).toEqual({ ok: true, value: [] });
    });

    it("should remove duplicates and keep the catalog order", () => {
      expect(validateDisabledSoundTags(["scream", "laugh", "long pause", "laugh", "cough"])).toEqual({
        ok: true, value: ["cough", "laugh", "scream", "long pause"],
      });
    });

    it("should ignore letter case and outer spaces", () => {
      expect(validateDisabledSoundTags([" Laugh ", "SHORT PAUSE"])).toEqual({ ok: true, value: ["laugh", "short pause"] });
    });

    it("should accept every tag of the catalog", () => {
      expect(validateDisabledSoundTags([...SOUND_TAG_NAMES].reverse())).toEqual({ ok: true, value: SOUND_TAG_NAMES });
    });

    it.each([["burp"], ["laughs"], [""], ["constructor"]])("should refuse the unknown name %p", (tag) => {
      expect(validateDisabledSoundTags(["laugh", tag])).toEqual({
        ok: false, reasonCode: "sound_tag_unknown", reasonParams: { tag },
      });
    });

    it.each([[undefined], [null], ["laugh"], [{ laugh: true }], [[1]], [[["laugh"]]]])("should refuse %p", (value) => {
      expect(validateDisabledSoundTags(value)).toEqual({ ok: false, reasonCode: "sound_tags_invalid" });
    });
  });
});
