import { describe, it, expect } from "vitest";
import { validateUpstreamMetas, validateUpstreamStreams, decodeCncRawId } from "../src/types/upstream.types";

describe("Upstream Schemas and Validation", () => {
  it("decodes CNC base64 ID correctly with URL-safe padding", () => {
    const rawId = "cnc:U3BvcnR6WExpdmVFdmVudHM6OnsiZXZlbnRJZCI6NTAwMTIsInRpdGxlIjoiUEFLIHZzIFNMIiwiY2F0IjoiQ3JpY2tldCJ9";
    const decoded = decodeCncRawId(rawId);
    expect(decoded.provider).toBe("SportzXLiveEvents");
    expect(decoded.data?.eventId).toBe(50012);
    expect(decoded.data?.title).toBe("PAK vs SL");
  });

  it("safely handles corrupted or malformed CNC raw IDs without throwing", () => {
    expect(decodeCncRawId("").provider).toBeUndefined();
    expect(decodeCncRawId("invalid:non-base64").provider).toBeUndefined();
    expect(decodeCncRawId("cnc:???malformed???").provider).toBeUndefined();
  });

  it("validates upstream meta arrays and filters out invalid objects", () => {
    const metas = [
      { id: "cnc:123", name: "Valid Match" },
      { id: null, name: "Missing ID" },
      "not an object",
      { id: "cnc:456", name: "Another Valid" },
    ];
    const valid = validateUpstreamMetas(metas);
    expect(valid).toHaveLength(2);
    expect(valid[0].name).toBe("Valid Match");
  });

  it("validates upstream stream arrays and filters out corrupted entries", () => {
    const streams = [
      { url: "https://stream.example/master.m3u8", title: "Valid Stream" },
      { url: null, title: "Missing URL" },
      "not an object",
      { url: "http://stream.example/live.mpd", title: "Valid Stream 2" },
    ];
    const valid = validateUpstreamStreams(streams);
    expect(valid).toHaveLength(2);
    expect(valid[0].url).toBe("https://stream.example/master.m3u8");
  });
});
