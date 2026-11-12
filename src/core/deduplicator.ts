import {
  UnifiedStream,
  LanguageInfo,
  StreamAuditSummary,
  StreamExclusion,
} from "../types/stream.types";
import { ChannelNormalizer } from "./channel-normalizer";
import { DrmDetector } from "./drm";

export class StreamDeduplicator {
  private static SPAM_KEYWORDS = [
    "goal:",
    "donate",
    "support the project",
    "supporter",
    "patreon",
    "buymeacoffee",
    "ko-fi",
    "paypal",
    "t.me/",
    "telegram",
    "join channel",
  ];

  private static RESOLUTION_DIMENSIONS: Record<string, { width: number; height: number }> = {
    "4K": { width: 3840, height: 2160 },
    "1080p": { width: 1920, height: 1080 },
    "720p": { width: 1280, height: 720 },
    "576p": { width: 1024, height: 576 },
    "540p": { width: 960, height: 540 },
    "480p": { width: 854, height: 480 },
    "396p": { width: 704, height: 396 },
    "360p": { width: 640, height: 360 },
    "288p": { width: 512, height: 288 },
  };

  /**
   * Identifies donation spam, promotional banners, or invalid candidates.
   */
  static checkExclusion(item: {
    url?: string;
    name?: string;
    title?: string;
    providerKey: string;
  }): StreamExclusion | null {
    const text = `${item.title ?? ""} ${item.name ?? ""} ${item.url ?? ""}`.toLowerCase();
    if (this.SPAM_KEYWORDS.some((kw) => text.includes(kw))) {
      return {
        reason: "DONATION_SPAM",
        provider: item.providerKey,
        details: "Filtered donation ad banner or non-media promotional candidate",
      };
    }
    const url = item.url?.trim();
    if (!url) {
      return {
        reason: "MISSING_URL",
        provider: item.providerKey,
        details: "Stream candidate contains no media playback URL",
      };
    }
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return {
        reason: "INVALID_SCHEME",
        provider: item.providerKey,
        details: `Disallowed protocol scheme: ${url.slice(0, 10)}`,
      };
    }
    return null;
  }

  /**
   * Backward-compatible check for spam.
   */
  static isSpam(title?: string, name?: string, url?: string): boolean {
    return this.checkExclusion({ title, name, url, providerKey: "unknown" }) !== null;
  }

  /**
   * Normalizes URL for fingerprint comparison:
   * Strips dynamic tokens, nonces, and timestamp tracking parameters,
   * while STRICTLY preserving quality variants (e.g. maxh=1080 vs maxh=720) so
   * distinct resolution renditions are never falsely collapsed.
   */
  static getUrlFingerprint(url: string): string {
    try {
      const u = new URL(url);
      // If it's a proxy url like /d/master.m3u8?d=...
      const nestedUrl = u.searchParams.get("d");
      if (nestedUrl) {
        const nestedFingerprint = this.getUrlFingerprint(nestedUrl);
        const maxh = u.searchParams.get("maxh");
        const clearkey = u.searchParams.get("clearkey");
        const qualityQualifier = maxh ? `::h${maxh}` : "";
        const drmQualifier = clearkey ? `::ck_${clearkey.slice(0, 8)}` : "";
        return `${nestedFingerprint}${qualityQualifier}${drmQualifier}`;
      }
      // Remove ephemeral tracking query parameters and sort deterministically
      const cleanEntries: [string, string][] = [];
      for (const [k, v] of u.searchParams.entries()) {
        const lowerKey = k.toLowerCase();
        if (
          !lowerKey.includes("token") &&
          !lowerKey.includes("expires") &&
          !lowerKey.includes("session") &&
          !lowerKey.includes("auth") &&
          !lowerKey.includes("sig") &&
          !lowerKey.startsWith("h_") &&
          lowerKey !== "h" &&
          lowerKey !== "t"
        ) {
          cleanEntries.push([k, v]);
        }
      }
      cleanEntries.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
      const cleanSearch = cleanEntries
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");

      return `${u.protocol}//${u.hostname.toLowerCase()}${u.pathname}${
        cleanSearch ? "?" + cleanSearch : ""
      }`;
    } catch {
      return url.split("?")[0];
    }
  }

  /**
   * Extracts quality variant (e.g. 4K, 1080p, 720p, 576p, 540p, 480p, 396p, 360p, 288p, Auto).
   */
  static extractQualityVariant(text: string, url: string): string {
    try {
      const u = new URL(url);
      const maxh = u.searchParams.get("maxh");
      if (maxh) {
        return `${maxh}p`;
      }
    } catch {}
    const t = text.toLowerCase();
    if (/\b(?:2160p|4k|uhd)\b/.test(t)) return "4K";
    if (/\b(?:1080p|fhd|1080)\b/.test(t)) return "1080p";
    if (/\b(?:720p|hd|720)\b/.test(t)) return "720p";
    if (/\b(?:576p|576)\b/.test(t)) return "576p";
    if (/\b(?:540p|540)\b/.test(t)) return "540p";
    if (/\b(?:480p|480)\b/.test(t)) return "480p";
    if (/\b(?:396p|396)\b/.test(t)) return "396p";
    if (/\b(?:360p|360)\b/.test(t)) return "360p";
    if (/\b(?:288p|288)\b/.test(t)) return "288p";
    return "Auto";
  }

  /**
   * Extracts estimated bitrate in bps from scraper title (e.g. "~8.3 Mbps" -> 8300000).
   */
  static extractBitrateBps(text: string): number {
    const mbpsMatch = text.match(/~?([\d.]+)\s*mbps/i);
    if (mbpsMatch) {
      const val = parseFloat(mbpsMatch[1]);
      if (!isNaN(val) && val > 0) return Math.round(val * 1_000_000);
    }
    const kbpsMatch = text.match(/~?([\d.]+)\s*kbps/i);
    if (kbpsMatch) {
      const val = parseFloat(kbpsMatch[1]);
      if (!isNaN(val) && val > 0) return Math.round(val * 1_000);
    }
    return 0;
  }

  /**
   * Extracts embedded header overrides (h_User-Agent, h_Referer, h_Origin) from proxy URLs.
   */
  static extractHeaders(
    url: string,
    proxyHeaders?: Record<string, string>
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      ...(proxyHeaders || {}),
    };
    try {
      const u = new URL(url);
      for (const [k, v] of u.searchParams.entries()) {
        if (k.toLowerCase() === "h_user-agent" && v) {
          headers["User-Agent"] = v;
        } else if (k.toLowerCase() === "h_referer" && v) {
          headers["Referer"] = v;
        } else if (k.toLowerCase() === "h_origin" && v) {
          headers["Origin"] = v;
        }
      }
    } catch {}
    return headers;
  }

  /**
   * Calculates source confidence score (0.00 - 1.00) based on stability signals.
   */
  static calculateSourceConfidence(
    url: string,
    isMultiSource: boolean,
    hasDrm: boolean
  ): { confidence: number; tier: "high" | "medium" | "standard" } {
    let score = 0.70;
    if (url.startsWith("https://")) score += 0.05;
    if (isMultiSource) score += 0.10;
    if (hasDrm) score += 0.05;
    if (
      url.includes("tapmad.com") ||
      url.includes("msnetworks.net") ||
      url.includes("pv-cdn.net") ||
      url.includes("aiv-cdn.net") ||
      url.includes("tamashaweb.com")
    ) {
      score += 0.10;
    }
    const finalScore = Math.min(0.99, Number(score.toFixed(2)));
    const tier: "high" | "medium" | "standard" =
      finalScore >= 0.85 ? "high" : finalScore >= 0.75 ? "medium" : "standard";
    return { confidence: finalScore, tier };
  }

  /**
   * Parses language code and badges from stream title.
   */
  static extractLanguage(text: string): LanguageInfo {
    const lower = text.toLowerCase();
    if (lower.includes("[hin]") || lower.includes("hindi") || lower.includes("(hin)")) {
      return { code: "hin", name: "Hindi", badge: "HIN" };
    }
    if (lower.includes("[tam]") || lower.includes("tamil") || lower.includes("(tam)")) {
      return { code: "tam", name: "Tamil", badge: "TAM" };
    }
    if (lower.includes("[tel]") || lower.includes("telugu") || lower.includes("(tel)")) {
      return { code: "tel", name: "Telugu", badge: "TEL" };
    }
    if (lower.includes("[ben]") || lower.includes("bengali") || lower.includes("(ben)")) {
      return { code: "ben", name: "Bengali", badge: "BEN" };
    }
    if (lower.includes("[kan]") || lower.includes("kannada") || lower.includes("(kan)")) {
      return { code: "kan", name: "Kannada", badge: "KAN" };
    }
    if (lower.includes("[mal]") || lower.includes("malayalam") || lower.includes("(mal)")) {
      return { code: "mal", name: "Malayalam", badge: "MAL" };
    }
    if (lower.includes("[mar]") || lower.includes("marathi") || lower.includes("(mar)")) {
      return { code: "mar", name: "Marathi", badge: "MAR" };
    }
    if (lower.includes("[urd]") || lower.includes("urdu") || lower.includes("(urd)")) {
      return { code: "urd", name: "Urdu", badge: "URD" };
    }
    if (lower.includes("[spa]") || lower.includes("espanol") || lower.includes("spanish")) {
      return { code: "spa", name: "Spanish", badge: "SPA" };
    }
    if (lower.includes("[ara]") || lower.includes("arabic") || lower.includes("(ara)")) {
      return { code: "ara", name: "Arabic", badge: "ARA" };
    }
    if (lower.includes("[fra]") || lower.includes("french") || lower.includes("francais")) {
      return { code: "fra", name: "French", badge: "FRA" };
    }
    if (lower.includes("[por]") || lower.includes("portuguese") || lower.includes("portugues")) {
      return { code: "por", name: "Portuguese", badge: "POR" };
    }
    if (lower.includes("[deu]") || lower.includes("german") || lower.includes("deutsch")) {
      return { code: "deu", name: "German", badge: "DEU" };
    }
    return { code: "eng", name: "English", badge: "ENG" };
  }

  /**
   * Cleans display title into a polished TV channel title (e.g. "Willow Cricket HD").
   */
  static cleanChannelName(rawName?: string, rawTitle?: string): { name: string; group: string } {
    return ChannelNormalizer.normalize(rawName, rawTitle);
  }

  public static PROVIDER_DISPLAY_NAMES: Record<string, string> = {
    cricify: "Cricify Live",
    sportzx: "SportzX",
    sktech: "SKTech",
    playztv: "PlayZ TV",
    livxow: "LivXow",
    playfy: "PlayFy",
  };

  /**
   * Deduplicates multi-provider stream candidates with transparent audit logging:
   * Merges identical URLs, preserves separate quality renditions (1080p, 720p, etc.),
   * parses top-level DRM keys, and calculates source confidence.
   */
  static deduplicateWithAudit(
    rawStreams: Array<{
      url?: string;
      name?: string;
      title?: string;
      clearkey?: string;
      providerKey: string;
      behaviorHints?: {
        proxyHeaders?: { request?: Record<string, string> };
      };
    }>
  ): { streams: UnifiedStream[]; audit: StreamAuditSummary } {
    const fingerprintMap = new Map<string, UnifiedStream>();
    const exclusions: StreamExclusion[] = [];

    for (const item of rawStreams) {
      const exclusion = this.checkExclusion(item);
      if (exclusion) {
        exclusions.push(exclusion);
        continue;
      }

      const url = item.url!.trim();
      const combinedTitle = `${item.title ?? ""} ${item.name ?? ""}`;
      const fingerprint = this.getUrlFingerprint(url);
      const language = this.extractLanguage(combinedTitle);
      const { name: channelName, group: channelGroup } = this.cleanChannelName(
        item.name,
        item.title
      );
      const qualityVariant = this.extractQualityVariant(combinedTitle, url);

      const providerDisplayName =
        this.PROVIDER_DISPLAY_NAMES[item.providerKey] ?? item.providerKey;

      const existing = fingerprintMap.get(fingerprint);
      if (existing) {
        // Record provenance only if from a distinct secondary provider
        if (
          item.providerKey !== existing.provenance.originProvider &&
          !existing.provenance.mirroredBy.includes(item.providerKey)
        ) {
          existing.provenance.mirroredBy.push(item.providerKey);
          existing.provenance.isMultiSource = true;
          existing.provenance.isExclusive = false;
          existing.provenance.sourceList.push({
            providerKey: item.providerKey,
            providerName: providerDisplayName,
            isPrimary: false,
          });

          const mirrorCount = existing.provenance.mirroredBy.length;
          existing.provenance.attributionBadge = `Multi-Source (${existing.provenance.originProviderName} + ${mirrorCount} Mirror${mirrorCount > 1 ? "s" : ""})`;
        }
        // Slightly boost reliability if verified by multiple providers
        existing.reliabilityScore = Math.min(99, existing.reliabilityScore + 2);
        // Recalculate source confidence with multi-source boost
        const updatedConfidence = this.calculateSourceConfidence(
          url,
          true,
          existing.drm !== null
        );
        existing.sourceConfidence = updatedConfidence.confidence;
        existing.confidenceTier = updatedConfidence.tier;
      } else {
        const streamId = `feed_${Math.abs(this.hashString(fingerprint)).toString(16)}`;
        const headers = this.extractHeaders(url, item.behaviorHints?.proxyHeaders?.request);

        let pathname = "";
        try {
          pathname = new URL(url).pathname.toLowerCase();
        } catch {
          pathname = url.split("?")[0].toLowerCase();
        }

        const isHlsPath = pathname.endsWith(".m3u8");
        const isMp4Path = pathname.endsWith(".mp4");
        const isDash =
          !isHlsPath && (pathname.endsWith(".mpd") || url.includes(".mpd") || combinedTitle.includes("DASH"));
        const protocol: "hls" | "dash" | "mp4" = isMp4Path
          ? "mp4"
          : isDash
          ? "dash"
          : "hls";

        // Parse DRM from explicit property, URL, and title
        const drm = DrmDetector.detectDrm(
          `${channelName} ${url} ${combinedTitle}`,
          item.clearkey
        );

        const { confidence, tier } = this.calculateSourceConfidence(
          url,
          false,
          drm !== null
        );

        const dims = this.RESOLUTION_DIMENSIONS[qualityVariant] || { width: 0, height: 0 };
        const bitrate = this.extractBitrateBps(combinedTitle);
        const refererParam = headers["Referer"]
          ? `&referer=${encodeURIComponent(headers["Referer"])}`
          : "";
        const edgeProxyFallbackUrl = `/api/proxy?url=${encodeURIComponent(url)}${refererParam}`;

        fingerprintMap.set(fingerprint, {
          streamId,
          channelName,
          channelGroup,
          priorityTier: fingerprintMap.size === 0 ? "primary" : "secondary",
          reliabilityScore: 92,
          sourceConfidence: confidence,
          confidenceTier: tier,
          qualityVariant,
          language,
          protocol,
          drm,
          network: {
            masterPlaylistUrl: url,
            edgeProxyFallbackUrl,
            requiredHeaders: headers,
          },
          provenance: {
            originProvider: item.providerKey,
            originProviderName: providerDisplayName,
            mirroredBy: [],
            isMultiSource: false,
            isExclusive: true,
            sourceList: [
              {
                providerKey: item.providerKey,
                providerName: providerDisplayName,
                isPrimary: true,
              },
            ],
            attributionBadge: `Exclusive to ${providerDisplayName}`,
          },
          hasPreParsedRenditions: false,
          renditions: [
            {
              qualityTag: qualityVariant !== "Auto" ? qualityVariant : "Auto",
              label:
                qualityVariant !== "Auto"
                  ? `${qualityVariant} (Adaptive)`
                  : "Auto (Adaptive)",
              height: dims.height,
              width: dims.width,
              bitrate,
              fps: dims.height >= 720 ? 50 : dims.height > 0 ? 30 : 0,
              url,
              isDefault: true,
            },
          ],
        });
      }
    }

    const streams = Array.from(fingerprintMap.values());
    const audit: StreamAuditSummary = {
      totalRawStreams: rawStreams.length,
      validStreamsCount: streams.length,
      excludedStreamsCount: exclusions.length,
      exclusions,
    };

    return { streams, audit };
  }

  /**
   * Backward-compatible deduplication returning streams array.
   */
  static deduplicate(
    rawStreams: Array<{
      url?: string;
      name?: string;
      title?: string;
      clearkey?: string;
      providerKey: string;
      behaviorHints?: {
        proxyHeaders?: { request?: Record<string, string> };
      };
    }>
  ): UnifiedStream[] {
    return this.deduplicateWithAudit(rawStreams).streams;
  }

  private static hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }
}
