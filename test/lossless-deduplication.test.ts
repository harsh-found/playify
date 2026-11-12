import { describe, it, expect } from "vitest";
import { StreamDeduplicator } from "../src/core/deduplicator";
import { DrmDetector } from "../src/core/drm";

describe("Lossless Stream Deduplication & Audit Engine", () => {
  it("preserves proxy streams with different maxh quality parameters as distinct renditions", () => {
    const rawStreams = [
      {
        providerKey: "playfy",
        title: "Main 1080p Stream",
        url: "http://129.225.106.195/d/master.m3u8?d=https%3A%2F%2Flinear.example.com%2Flive.mpd&maxh=1080",
      },
      {
        providerKey: "playfy",
        title: "Secondary 720p Stream",
        url: "http://129.225.106.195/d/master.m3u8?d=https%3A%2F%2Flinear.example.com%2Flive.mpd&maxh=720",
      },
      {
        providerKey: "cricify",
        title: "Identical 720p Duplicate",
        url: "http://129.225.106.195/d/master.m3u8?d=https%3A%2F%2Flinear.example.com%2Flive.mpd&maxh=720",
      },
    ];

    const { streams, audit } = StreamDeduplicator.deduplicateWithAudit(rawStreams);

    // Should preserve both 1080p and 720p, but merge the identical 720p duplicate
    expect(streams).toHaveLength(2);
    expect(audit.totalRawStreams).toBe(3);
    expect(audit.validStreamsCount).toBe(2);

    const qualities = streams.map((s) => s.qualityVariant);
    expect(qualities).toContain("1080p");
    expect(qualities).toContain("720p");

    // The 720p stream should have multi-source attribution
    const stream720 = streams.find((s) => s.qualityVariant === "720p");
    expect(stream720?.provenance.mirroredBy).toContain("cricify");
    expect(stream720?.provenance.isMultiSource).toBe(true);
    expect(stream720?.sourceConfidence).toBeGreaterThanOrEqual(0.70);
  });

  it("extracts and verifies top-level clearkey configuration from upstream stream objects", () => {
    const kid = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4";
    const key = "11223344556677889900aabbccddeeff";
    const explicitClearkey = `${kid}:${key}`;

    const drm = DrmDetector.detectDrm("", explicitClearkey);
    expect(drm).not.toBeNull();
    expect(drm?.type).toBe("clearkey");
    expect(drm?.keys).toBeDefined();
    expect(drm?.keys?.[0].kid).toBe(kid);
    expect(drm?.keys?.[0].key).toBe(key);

    // Integrated deduplicator test with explicit clearkey
    const rawStreams = [
      {
        providerKey: "livxow",
        title: "Sony TEN 1 HD [ClearKey]",
        url: "https://linear.live.com/dash/sonyten1/manifest.mpd",
        clearkey: explicitClearkey,
      },
    ];

    const { streams } = StreamDeduplicator.deduplicateWithAudit(rawStreams);
    expect(streams).toHaveLength(1);
    expect(streams[0].drm?.type).toBe("clearkey");
    expect(streams[0].drm?.keys?.[0].kid).toBe(kid);
  });

  it("identifies donation spam, missing urls, and invalid protocols with transparent audit entries", () => {
    const rawStreams = [
      {
        providerKey: "sktech",
        title: "DONATE VIA UPI TO KEEP SERVERS ALIVE",
        url: "https://t.me/donations_bot",
      },
      {
        providerKey: "playztv",
        title: "Valid Sports Stream",
        url: "",
      },
      {
        providerKey: "sportzx",
        title: "RTSP Unsupported Feed",
        url: "rtsp://live.stream.internal/feed",
      },
      {
        providerKey: "sportzx",
        title: "Telegram Promo Banner Buy VIP",
        url: "https://vip.streams.online",
      },
      {
        providerKey: "cricify",
        title: "Legitimate Live Match",
        url: "https://stream.cdn.net/hls/live.m3u8",
      },
    ];

    const { streams, audit } = StreamDeduplicator.deduplicateWithAudit(rawStreams);

    expect(streams).toHaveLength(1);
    expect(audit.totalRawStreams).toBe(5);
    expect(audit.validStreamsCount).toBe(1);
    expect(audit.excludedStreamsCount).toBe(4);

    const reasons = audit.exclusions.map((e) => e.reason);
    expect(reasons).toContain("DONATION_SPAM");
    expect(reasons).toContain("MISSING_URL");
    expect(reasons).toContain("INVALID_SCHEME");
  });

  it("assigns confidence score, confidence tier, and quality variants accurately", () => {
    const rawStreams = [
      {
        providerKey: "livxow",
        title: "Sky Sports Main Event 1080p FHD",
        url: "https://secure.stream.net/hls/skymain.m3u8",
      },
    ];

    const { streams } = StreamDeduplicator.deduplicateWithAudit(rawStreams);
    expect(streams[0].qualityVariant).toBe("1080p");
    expect(streams[0].confidenceTier).toBeDefined();
    expect(streams[0].sourceConfidence).toBeGreaterThanOrEqual(0.70);
  });
});
