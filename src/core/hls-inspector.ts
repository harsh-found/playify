import { StreamRendition } from "../types/stream.types";

export class HlsInspector {
  /**
   * Resolves a relative rendition URL against the master playlist URL.
   */
  static resolveUrl(relativeUrl: string, masterUrl: string): string {
    try {
      const master = new URL(masterUrl);
      const resolved = new URL(relativeUrl, master);
      if (!resolved.search && master.search) {
        resolved.search = master.search;
      }
      return resolved.toString();
    } catch {
      return relativeUrl;
    }
  }

  /**
   * Parses M3U8 master playlist text and extracts all real video stream renditions.
   */
  static parseMasterPlaylist(m3u8Text: string, masterUrl: string): StreamRendition[] {
    const renditions: StreamRendition[] = [
      {
        qualityTag: "Auto",
        label: "Auto (Adaptive)",
        height: 0,
        width: 0,
        bitrate: 0,
        fps: 0,
        url: masterUrl,
        isDefault: true,
      },
    ];

    const lines = m3u8Text.split(/\r?\n/);
    const seenHeights = new Set<number>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/i);
        const resolutionMatch = line.match(/RESOLUTION=(\d+)x(\d+)/i);
        const fpsMatch = line.match(/FRAME-RATE=([\d.]+)/i);

        const bitrate = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;
        const width = resolutionMatch ? parseInt(resolutionMatch[1], 10) : 0;
        const height = resolutionMatch ? parseInt(resolutionMatch[2], 10) : 0;
        const fps = fpsMatch ? Math.round(parseFloat(fpsMatch[1])) : 30;

        // The next non-empty, non-comment line is the rendition URI
        let streamUri = "";
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j].trim();
          if (nextLine && !nextLine.startsWith("#")) {
            streamUri = nextLine;
            i = j;
            break;
          }
        }

        if (streamUri && height > 0 && !seenHeights.has(height)) {
          seenHeights.add(height);
          const fullUrl = this.resolveUrl(streamUri, masterUrl);

          let qualityTag = `${height}p`;
          let label = `${height}p`;

          if (height >= 1080) {
            qualityTag = "1080p";
            label = fps >= 50 ? "1080p FHD (50fps)" : "1080p FHD";
          } else if (height >= 720) {
            qualityTag = "720p";
            label = "720p HD";
          } else if (height >= 540) {
            qualityTag = "540p";
            label = "540p";
          } else if (height >= 480) {
            qualityTag = "480p";
            label = "480p SD";
          } else if (height >= 360) {
            qualityTag = "360p";
            label = "360p";
          }

          renditions.push({
            qualityTag,
            label,
            height,
            width,
            bitrate,
            fps,
            url: fullUrl,
          });
        }
      }
    }

    // Sort: Auto first, then descending by height & bitrate
    renditions.sort((a, b) => {
      if (a.qualityTag === "Auto") return -1;
      if (b.qualityTag === "Auto") return 1;
      return b.height - a.height || b.bitrate - a.bitrate;
    });

    return renditions;
  }

  /**
   * Fetches an M3U8 playlist with a 4-second timeout and extracts renditions.
   */
  static async inspectStream(
    masterUrl: string,
    headers?: Record<string, string>
  ): Promise<StreamRendition[]> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 4000);

      const resp = await fetch(masterUrl, {
        signal: controller.signal,
        headers: headers || {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          Accept: "*/*",
        },
      });

      if (resp.ok) {
        const text = await resp.text();
        if (text.includes("#EXTM3U")) {
          return this.parseMasterPlaylist(text, masterUrl);
        }
      }
    } catch {
      // Fallback silently to single default rendition
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    return [
      {
        qualityTag: "Auto",
        label: "Auto (Adaptive)",
        height: 0,
        width: 0,
        bitrate: 0,
        fps: 0,
        url: masterUrl,
        isDefault: true,
      },
    ];
  }
}
