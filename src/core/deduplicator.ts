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
   * Extracts quality variant (e.g. 1080p, 720p, 576p, 396p, Auto).
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
    if (/\b(?:1080p|fhd|1080)\b/.test(t)) return "1080p";
    if (/\b(?:720p|hd|720)\b/.test(t)) return "720p";
    if (/\b(?:576p|576)\b/.test(t)) return "576p";
    if (/\b(?:540p|540)\b/.test(t)) return "540p";
    if (/\b(?:480p|480)\b/.test(t)) return "480p";
    if (/\b(?:396p|396)\b/.test(t)) return "396p";
    if (/\b(?:360p|360)\b/.test(t)) return "360p";
    return "Auto";
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
      url.includes("aiv-cdn.net")
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
    if (lower.includes("[urd]") || lower.includes("urdu") || lower.includes("(urd)")) {
      return { code: "urd", name: "Urdu", badge: "URD" };
    }
    if (lower.includes("[spa]") || lower.includes("espanol") || lower.includes("spanish")) {
      return { code: "spa", name: "Spanish", badge: "SPA" };
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
        const headers = item.behaviorHints?.proxyHeaders?.request || {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        };

        const isDash = url.includes(".mpd") || combinedTitle.includes("DASH");
        const protocol: "hls" | "dash" = isDash ? "dash" : "hls";

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
              label: qualityVariant !== "Auto" ? `${qualityVariant} (Adaptive)` : "Auto (Adaptive)",
              height: 0,
              width: 0,
              bitrate: 0,
              fps: 0,
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
