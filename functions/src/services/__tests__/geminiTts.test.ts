/**
 * Unit tests for the Gemini TTS client helpers. The request itself is tested
 * through POST /api/tts/test in api/__tests__/misc.integration.test.ts.
 */

import { applyGain, languageHint, wavFromPcm } from "../geminiTts";

function pcmOf(samples: number[]): Buffer {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, i) => pcm.writeInt16LE(sample, i * 2));
  return pcm;
}

function samplesOf(pcm: Buffer, offset = 0): number[] {
  const samples: number[] = [];
  for (let i = offset; i + 1 < pcm.length; i += 2) samples.push(pcm.readInt16LE(i));
  return samples;
}

describe("geminiTts", () => {
  describe("languageHint", () => {
    it.each([
      ["English", "en"],
      ["Japanese", "ja"],
      ["Chinese,Yue", "yue"],
    ])("should give the tag of %s", (languageBoost, tag) => {
      expect(languageHint(languageBoost)).toBe(tag);
    });

    it.each([["auto"], ["Automatic"], ["None"], [""], ["Klingon"], ["constructor"], [null], [undefined], [5]])(
      "should give null for %p", (languageBoost) => {
        expect(languageHint(languageBoost)).toBeNull();
      });
  });

  describe("applyGain", () => {
    it("should multiply the samples", () => {
      expect(samplesOf(applyGain(pcmOf([100, -100, 0, 3]), 2.5))).toEqual([250, -250, 0, 8]);
    });

    it("should clip at full scale", () => {
      expect(samplesOf(applyGain(pcmOf([20000, -20000]), 2))).toEqual([32767, -32768]);
    });

    it.each([[1], [0], [-1], [NaN]])("should leave the samples as they are for a volume of %p", (volume) => {
      expect(samplesOf(applyGain(pcmOf([100, -100]), volume))).toEqual([100, -100]);
    });

    it("should leave the bytes before the offset as they are", () => {
      const wav = wavFromPcm(pcmOf([100, -100]));
      const header = Buffer.from(wav.subarray(0, 44));
      applyGain(wav, 0.5, 44);
      expect(wav.subarray(0, 44)).toEqual(header);
      expect(samplesOf(wav, 44)).toEqual([50, -50]);
    });
  });

  describe("wavFromPcm", () => {
    it("should write a 44-byte header for 16-bit mono PCM", () => {
      const wav = wavFromPcm(pcmOf([1, 2, 3]), 24000);
      expect(wav.length).toBe(44 + 6);
      expect(wav.toString("latin1", 0, 4)).toBe("RIFF");
      expect(wav.readUInt32LE(4)).toBe(36 + 6);
      expect(wav.toString("latin1", 8, 16)).toBe("WAVEfmt ");
      expect(wav.readUInt16LE(22)).toBe(1);
      expect(wav.readUInt32LE(24)).toBe(24000);
      expect(wav.readUInt32LE(28)).toBe(48000);
      expect(wav.readUInt16LE(34)).toBe(16);
      expect(wav.toString("latin1", 36, 40)).toBe("data");
      expect(wav.readUInt32LE(40)).toBe(6);
    });
  });
});
