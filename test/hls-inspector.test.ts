import { describe, it, expect } from "vitest";
import { HlsInspector } from "../src/core/hls-inspector";

describe("HlsInspector Unit Tests", () => {
  const sampleM3u8 = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-STREAM-INF:BANDWIDTH=8500000,AVERAGE-BANDWIDTH=8000000,RESOLUTION=1920x1080,FRAME-RATE=50.000,CODECS="avc1.64002a,mp4a.40.2"
tracks-v1a1/1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4500000,AVERAGE-BANDWIDTH=4000000,RESOLUTION=1280x720,FRAME-RATE=50.000,CODECS="avc1.64001f,mp4a.40.2"
tracks-v1a1/720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1800000,AVERAGE-BANDWIDTH=1500000,RESOLUTION=854x480,FRAME-RATE=25.000,CODECS="avc1.4d401f,mp4a.40.2"
https://absolute.cdn.com/tracks-v1a1/480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=800000,AVERAGE-BANDWIDTH=700000,RESOLUTION=640x360,FRAME-RATE=25.000,CODECS="avc1.4d401e,mp4a.40.2"
tracks-v1a1/360p.m3u8
`;

  it("parses master playlist text and resolves relative URLs", () => {
    const masterUrl = "https://dai-fancode.pages.dev/live/master.m3u8";
    const renditions = HlsInspector.parseMasterPlaylist(sampleM3u8, masterUrl);

    // Auto + 1080p + 720p + 480p + 360p = 5 renditions
    expect(renditions).toHaveLength(5);

    expect(renditions[0].qualityTag).toBe("Auto");
    expect(renditions[0].url).toBe(masterUrl);

    // 1080p
    const r1080 = renditions.find((r) => r.qualityTag === "1080p");
    expect(r1080).toBeDefined();
    expect(r1080?.height).toBe(1080);
    expect(r1080?.fps).toBe(50);
    expect(r1080?.label).toBe("1080p FHD (50fps)");
    expect(r1080?.url).toBe("https://dai-fancode.pages.dev/live/tracks-v1a1/1080p.m3u8");

    // 720p
    const r720 = renditions.find((r) => r.qualityTag === "720p");
    expect(r720).toBeDefined();
    expect(r720?.height).toBe(720);

    // 480p (preserves absolute URL)
    const r480 = renditions.find((r) => r.qualityTag === "480p");
    expect(r480).toBeDefined();
    expect(r480?.url).toBe("https://absolute.cdn.com/tracks-v1a1/480p.m3u8");
  });

  it("inherits authentication query parameters from master URL to relative variants", () => {
    const authenticatedMaster = "https://cdn.example.com/live/stream.m3u8?token=secure123&exp=999999";
    const renditions = HlsInspector.parseMasterPlaylist(sampleM3u8, authenticatedMaster);

    const r1080 = renditions.find((r) => r.qualityTag === "1080p");
    expect(r1080).toBeDefined();
    expect(r1080?.url).toBe(
      "https://cdn.example.com/live/tracks-v1a1/1080p.m3u8?token=secure123&exp=999999"
    );
  });
});
