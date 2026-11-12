import { describe, it, expect } from "vitest";
import { StreamDeduplicator } from "../src/core/deduplicator";

describe("StreamDeduplicator Unit Tests", () => {
  it("filters out donation spam and ad cards", () => {
    expect(
      StreamDeduplicator.isSpam("❤️ November goal: $30 of $100", "✨ | support the project!")
    ).toBe(true);
    expect(StreamDeduplicator.isSpam("Click here to donate", "PayPal")).toBe(true);
    expect(StreamDeduplicator.isSpam("Normal Title", "Normal Name", "")).toBe(true); // empty url
    expect(
      StreamDeduplicator.isSpam(
        "A Sports FHD",
        "SportzX",
        "https://live.msnetworks.net/a-sports/master.m3u8"
      )
    ).toBe(false);
  });

  it("extracts clean URL fingerprints stripping ephemeral tokens", () => {
    const url1 = "https://cdn.example.com/live/master.m3u8?token=xyz123&expires=999999&auth=abc";
    const url2 = "https://cdn.example.com/live/master.m3u8?token=differentaaa&expires=8888";

    expect(StreamDeduplicator.getUrlFingerprint(url1)).toBe(
      StreamDeduplicator.getUrlFingerprint(url2)
    );
  });

  it("ensures query parameter order invariance in URL fingerprinting", () => {
    const u1 = "https://live.cdn.com/stream.m3u8?channel=sky1&lang=eng";
    const u2 = "https://live.cdn.com/stream.m3u8?lang=eng&channel=sky1";
    expect(StreamDeduplicator.getUrlFingerprint(u1)).toBe(
      StreamDeduplicator.getUrlFingerprint(u2)
    );
  });

  it("unwraps nested proxy URLs and matches fingerprints across query permutations", () => {
    const url1 =
      "http://129.225.106.195/d/master.m3u8?d=https%3A%2F%2Fcdn.example.com%2Fstream%2Fmaster.mpd%3Ftoken%3Dabc123%26expires%3D9999";
    const url2 =
      "http://129.225.106.195/d/master.m3u8?d=https%3A%2F%2Fcdn.example.com%2Fstream%2Fmaster.mpd%3Ftoken%3Dxyz789%26expires%3D8888";
    expect(StreamDeduplicator.getUrlFingerprint(url1)).toBe(
      StreamDeduplicator.getUrlFingerprint(url2)
    );
  });

  it("merges same feed from 2 providers with multi-source attribution", () => {
    const streams = [
      { url: "https://stream.live/feed.m3u8", name: "Willow HD", providerKey: "livxow" },
      {
        url: "https://stream.live/feed.m3u8?session=new",
        name: "WILLOW CRICKET",
        providerKey: "sportzx",
      },
    ];
    const unified = StreamDeduplicator.deduplicate(streams);
    expect(unified).toHaveLength(1);
    expect(unified[0].provenance.isMultiSource).toBe(true);
    expect(unified[0].provenance.mirroredBy).toContain("sportzx");
  });

  it("collapses artificial duplicate qualities of the exact same master playlist into 1 stream", () => {
    const rawStreams = [
      // 1. Donation spam
      {
        name: "✨ | support the project!",
        title: "❤️ November goal: $30 of $100",
        providerKey: "sportzx",
      },
      // 2. Willow FHD 1080p copy
      {
        name: "🎬SportzxProvider 🧊 1080p • CNCVerse Bridge",
        title: "⚡ Direct 1080p · ~8.3 Mbps · WILLOW - FHD",
        url: "http://129.225.106.195/d/master.m3u8?d=https%3A%2F%2Fotte.cache.aiv-cdn.net%2Fia",
        providerKey: "sportzx",
      },
      // 3. Willow FHD 720p copy (same URL!)
      {
        name: "🎬SportzxProvider 😮‍💨 720p • CNCVerse Bridge",
        title: "⚡ Direct 720p · ~4.3 Mbps · WILLOW - FHD",
        url: "http://129.225.106.195/d/master.m3u8?d=https%3A%2F%2Fotte.cache.aiv-cdn.net%2Fia",
        providerKey: "sportzx",
      },
      // 4. Willow FHD 360p copy (same URL!)
      {
        name: "🎬SportzxProvider 😮‍💨 360p • CNCVerse Bridge",
        title: "⚡ Direct 396p · ~0.5 Mbps · WILLOW - FHD",
        url: "http://129.225.106.195/d/master.m3u8?d=https%3A%2F%2Fotte.cache.aiv-cdn.net%2Fia",
        providerKey: "sportzx",
      },
      // 5. Willow FHD mirrored by SKTech
      {
        name: "Willow Cricket HD",
        title: "Willow Cricket [ENG]",
        url: "http://129.225.106.195/d/master.m3u8?d=https%3A%2F%2Fotte.cache.aiv-cdn.net%2Fia",
        providerKey: "sktech",
      },
      // 6. Distinct channel: A Sports FHD
      {
        name: "🎬SportzxProvider Auto",
        title: "A Sports FHD",
        url: "https://live.msnetworks.net/a-sports/master.m3u8",
        providerKey: "sportzx",
      },
    ];

    const deduplicated = StreamDeduplicator.deduplicate(rawStreams);

    // Should collapse into exactly 2 unique streams (Willow and A Sports)
    expect(deduplicated).toHaveLength(2);

    const willowStream = deduplicated.find((s) => s.channelGroup === "Willow");
    expect(willowStream).toBeDefined();
    expect(willowStream?.provenance.originProvider).toBe("sportzx");
    expect(willowStream?.provenance.originProviderName).toBe("SportzX");
    expect(willowStream?.provenance.mirroredBy).toContain("sktech");
    expect(willowStream?.provenance.isMultiSource).toBe(true);
    expect(willowStream?.provenance.isExclusive).toBe(false);
    expect(willowStream?.provenance.sourceList).toHaveLength(2);
    expect(willowStream?.provenance.attributionBadge).toBe("Multi-Source (SportzX + 1 Mirror)");

    const aSportsStream = deduplicated.find((s) => s.channelName.includes("A Sports"));
    expect(aSportsStream).toBeDefined();
    expect(aSportsStream?.provenance.isExclusive).toBe(true);
    expect(aSportsStream?.provenance.isMultiSource).toBe(false);
    expect(aSportsStream?.provenance.attributionBadge).toBe("Exclusive to SportzX");
  });

  it("unifies equivalent AIV CDN edge hostnames across providers while preserving all mirrorUrls", () => {
    const u1 =
      "http://129.225.106.195/d/master.m3u8?d=https%3A%2F%2Fotte.cache.aiv-cdn.net%2Fiad-nitro%2Flive%2Fclients%2Fdash%2Fenc%2Ff60kqesunw%2Fout%2Fv1%2Fa435ed7a00f947deb4369b46d8f2fb70%2Fcenc.mpd&clearkey=1779c27b9d077a3ba0c9cc1bb9a94b9f%3Acc5ab0ce799d09b73cad4b2ded3b7bbd&maxh=1080";
    const u2 =
      "http://129.225.106.195/d/master.m3u8?d=https%3A%2F%2Fotte.live.fly.ww.aiv-cdn.net%2Fiad-nitro%2Flive%2Fclients%2Fdash%2Fenc%2Ff60kqesunw%2Fout%2Fv1%2Fa435ed7a00f947deb4369b46d8f2fb70%2Fcenc.mpd&clearkey=1779c27b9d077a3ba0c9cc1bb9a94b9f%3Acc5ab0ce799d09b73cad4b2ded3b7bbd&maxh=1080";

    expect(StreamDeduplicator.getUrlFingerprint(u1)).toBe(
      StreamDeduplicator.getUrlFingerprint(u2)
    );

    const unified = StreamDeduplicator.deduplicate([
      { url: u1, name: "WILLOW FHD", title: "1080p", providerKey: "sportzx" },
      { url: u2, name: "Willow Cricket HD", title: "1080p", providerKey: "playfy" },
    ]);

    expect(unified).toHaveLength(1);
    expect(unified[0].provenance.isMultiSource).toBe(true);
    expect(unified[0].network.mirrorUrls).toHaveLength(2);
    expect(unified[0].network.mirrorUrls?.map((m) => m.providerKey)).toEqual([
      "sportzx",
      "playfy",
    ]);
  });
});

