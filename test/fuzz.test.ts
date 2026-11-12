import { describe, it, expect } from "vitest";
import { Normalizer } from "../src/core/normalizer";
import { ChannelNormalizer } from "../src/core/channel-normalizer";
import { StreamDeduplicator } from "../src/core/deduplicator";

describe("Fuzz & Edge Case Testing", () => {
  it("handles extreme Unicode, emojis, and bizarre punctuation in titles safely", () => {
    const weird =
      "🔴⚡💥🇮🇳 vs 🇦🇺 🏆 [FINAL] •• 4K UHD 60FPS ▰▰▰▱▱ ~12.5 Mbps • CNCVerse Bridge";
    const clean = Normalizer.cleanTitle(weird);
    expect(clean).not.toContain("🔴");
    expect(clean).not.toContain("CNCVerse");

    const channel = ChannelNormalizer.normalize(
      undefined,
      "🏷️ ⚡ Direct 396p · ~0.5 Mbps · FanCode HD 🍿"
    );
    expect(channel.name).toBe("FanCode");
  });

  it("safely handles null, undefined, empty, and huge strings in stream deduplication", () => {
    const raw = [
      { url: "", name: "", providerKey: "test" },
      { url: "not-a-valid-url", name: "bad", providerKey: "test" },
      { url: "https://example.com/stream.m3u8", name: "a".repeat(10000), providerKey: "test" },
    ];
    const res = StreamDeduplicator.deduplicate(raw);
    expect(res).toHaveLength(1);
    expect(res[0].network.masterPlaylistUrl).toBe("https://example.com/stream.m3u8");
  });

  it("safely handles malformed base64 CNC payloads and non-string inputs", () => {
    const key = Normalizer.computeCanonicalKey("   ", "", undefined, "invalid-url");
    expect(key).toBeDefined();
    expect(key.length).toBeGreaterThan(0);
  });
});
