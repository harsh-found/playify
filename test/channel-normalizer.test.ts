import { describe, it, expect } from "vitest";
import { ChannelNormalizer } from "../src/core/channel-normalizer";

describe("ChannelNormalizer Unit Tests", () => {
  it("normalizes emoji-laden and bitrate-prefixed raw titles into pristine broadcast names", () => {
    // 1. User screenshot defect: 🏷️ ⚡ Direct 396p • ~0.5 Mbps • SKY TOP EVENT FHD
    const sky = ChannelNormalizer.normalize(
      "🎬LivxowProvider Auto",
      "🏷️ ⚡ Direct 396p • ~0.5 Mbps • SKY TOP EVENT FHD"
    );
    expect(sky.name).toBe("Sky Sports Main Event");
    expect(sky.group).toBe("Sky Sports");

    // 2. Willow variant
    const willow = ChannelNormalizer.normalize(
      "🎬SportzxProvider 😮‍💨 720p • CNCVerse Bridge",
      "⚡ Direct 720p · ~4.3 Mbps · WILLOW - FHD"
    );
    expect(willow.name).toBe("Willow Cricket HD");
    expect(willow.group).toBe("Willow");

    // 3. Sony LIV defect
    const sony = ChannelNormalizer.normalize(
      "Direct 396p",
      "🏷️ ⚡ Direct 396p • ~0.5 Mbps • SonyLiv PRIME FHD"
    );
    expect(sony.name).toBe("Sony LIV");
    expect(sony.group).toBe("Sony Sports Network");

    // 4. FanCode
    const fancode = ChannelNormalizer.normalize("FanCode", "⚡ Direct 1080p • FanCode Cricket HD");
    expect(fancode.name).toBe("FanCode");
    expect(fancode.group).toBe("FanCode");

    // 5. Generic Tennis Event
    const tennis = ChannelNormalizer.normalize(
      "Direct 288p",
      "🏷️ ⚡ Direct 288p • ~0.3 Mbps • TENNIS EVENTO"
    );
    expect(tennis.name).toBe("Tennis Evento");
    expect(tennis.group).toBe("General Sports");
  });

  it("strips spam, URLs, and telegram trailers cleanly", () => {
    const stream = ChannelNormalizer.normalize(
      "Live",
      "SuperSport Cricket HD ✅ Buffer-free 🍿 Join telegram t.me/sports"
    );
    expect(stream.name).toBe("SuperSport Cricket");
    expect(stream.group).toBe("SuperSport");
  });

  it("extracts channel line correctly from multi-line Stremio scraper titles", () => {
    const rawTitle = `✅ Buffer-free · lowest quality (recommended)\n🍿 TENNIS EVENTO\n🏷️ ⚡ Direct 396p · ~0.5 Mbps · SKY TOP EVENT FHD\n🎞️ 360p • DASH\n🛰️ Source: LivXowProvider • ⚡LivXow Live Events\n🙊 No included subtitles`;
    const res = ChannelNormalizer.normalize(undefined, rawTitle);
    expect(res.name).toBe("Sky Sports Main Event");
    expect(res.group).toBe("Sky Sports");
  });

  it("does not let bitrate 396p trigger beIN Sports 3 or 1080p trigger TNT Sports 1", () => {
    const beinTitle = `✅ Buffer-free\n🏷️ ⚡ Direct 396p · ~0.5 Mbps · beIN ENGLISH FHD 🎧 Audio: English`;
    const beinRes = ChannelNormalizer.normalize(undefined, beinTitle);
    expect(beinRes.name).toBe("beIN Sports English");
    expect(beinRes.group).toBe("beIN Sports");

    const tntTitle = `🏷️ ⚡ Direct 1080p · ~8.3 Mbps · TNT SPORTS HD`;
    const tntRes = ChannelNormalizer.normalize(undefined, tntTitle);
    expect(tntRes.name).toBe("TNT Sports HD");
    expect(tntRes.group).toBe("TNT Sports");
  });

  it("normalizes generic SD SERVER and server feeds cleanly", () => {
    const raw = `✅ Buffer-free\n🏷️ SD SERVER\n🎞️ Auto • HLS`;
    const res = ChannelNormalizer.normalize(undefined, raw);
    expect(res.name).toBe("Standard Feed");
    expect(res.group).toBe("General Sports");

    const rawWithPrefix = `✅ Buffer-free\n🏷️ ⚡ Direct 396p · ~0.5 Mbps · SD SERVER\n🎞️ Auto • HLS`;
    const res2 = ChannelNormalizer.normalize(undefined, rawWithPrefix);
    expect(res2.name).toBe("Standard Feed");
    expect(res2.group).toBe("General Sports");
  });

  it("uses URL-assisted inference for bare language feeds and prevents bare language channel names", () => {
    const sonyHindi = ChannelNormalizer.normalize(
      "SK LIVE",
      "HINDI 🇮🇳",
      "https://sonymtmnew-akamaized.pages.dev/master.m3u8?id=311002"
    );
    expect(sonyHindi.name).toBe("Sony LIV");
    expect(sonyHindi.group).toBe("Sony Sports Network");

    const bareLang = ChannelNormalizer.normalize(
      "Live",
      "HINDI 🇮🇳",
      "https://generic-cdn.example.com/live/master.m3u8"
    );
    expect(bareLang.name).toBe("Live Broadcast (Hindi)");
    expect(bareLang.group).toBe("General Sports");
  });
});

