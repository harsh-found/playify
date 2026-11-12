import {
  UnifiedStream,
  LanguageInfo,
  StreamAuditSummary,
  StreamExclusion,
  ChannelMirrorGroup,
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

  private static LANGUAGE_RULES: Array<{
    info: LanguageInfo;
    textRegex: RegExp;
    urlRegex?: RegExp;
  }> = [
    {
      info: { code: "hin", name: "Hindi", badge: "HIN" },
      textRegex: /\b(?:hin|hindi)\b/i,
      urlRegex: /(?:\/|-|_)(?:hin|hindi)(?:\/|-|_|\.)/i,
    },
    {
      info: { code: "tam", name: "Tamil", badge: "TAM" },
      textRegex: /\b(?:tam|tamil)\b/i,
      urlRegex: /(?:\/|-|_)(?:tam|tamil)(?:\/|-|_|\.)/i,
    },
    {
      info: { code: "tel", name: "Telugu", badge: "TEL" },
      textRegex: /\b(?:tel|telugu)\b/i,
      urlRegex: /(?:\/|-|_)(?:tel|telugu)(?:\/|-|_|\.)/i,
    },
    {
      info: { code: "kan", name: "Kannada", badge: "KAN" },
      textRegex: /\b(?:kan|kannada)\b/i,
      urlRegex: /(?:\/|-|_)(?:kan|kannada)(?:\/|-|_|\.)/i,
    },
    {
      info: { code: "ben", name: "Bengali", badge: "BEN" },
      textRegex: /\b(?:ben|bengali|bangla)\b/i,
      urlRegex: /(?:\/|-|_)(?:ben|bengali)(?:\/|-|_|\.)/i,
    },
    {
      info: { code: "mal", name: "Malayalam", badge: "MAL" },
      textRegex: /\b(?:mal|malayalam)\b/i,
      urlRegex: /(?:\/|-|_)(?:mal|malayalam)(?:\/|-|_|\.)/i,
    },
    {
      info: { code: "mar", name: "Marathi", badge: "MAR" },
      textRegex: /\b(?:mar|marathi)\b/i,
      urlRegex: /(?:\/|-|_)(?:mar|marathi)(?:\/|-|_|\.)/i,
    },
    {
      info: { code: "guj", name: "Gujarati", badge: "GUJ" },
      textRegex: /\b(?:guj|gujarati)\b/i,
      urlRegex: /(?:\/|-|_)(?:guj|gujarati)(?:\/|-|_|\.)/i,
    },
    {
      info: { code: "pun", name: "Punjabi", badge: "PUN" },
      textRegex: /\b(?:pun|punjabi)\b/i,
      urlRegex: /(?:\/|-|_)(?:pun|punjabi)(?:\/|-|_|\.)/i,
    },
    {
      info: { code: "urd", name: "Urdu", badge: "URD" },
      textRegex: /\b(?:urd|urdu)\b/i,
      urlRegex: /(?:\/|-|_)(?:urd|urdu)(?:\/|-|_|\.)/i,
    },
    {
      info: { code: "spa", name: "Spanish", badge: "SPA" },
      textRegex: /(?:\b(?:spa|spanish|espanol|español|vix\s+espanol)\b|🇪🇸|🇲🇽|🇦🇷)/iu,
      urlRegex: /(?:\/|-|_)(?:spa|spanish|esp)(?:\/|-|_|\.)/i,
    },
    {
      info: { code: "ara", name: "Arabic", badge: "ARA" },
      textRegex: /(?:\b(?:ara|arabic)\b|🇸🇦|🇦🇪|🇶🇦|🇪🇬)/iu,
      urlRegex: /(?:\/|-|_)(?:ara|arabic)(?:\/|-|_|\.)/i,
    },
    {
      info: { code: "fra", name: "French", badge: "FRA" },
      textRegex: /(?:\b(?:fra|french|francais|français|auvio)\b|🇫🇷|🇧🇪)/iu,
      urlRegex: /(?:\/|-|_)(?:fra|french)(?:\/|-|_|\.)/i,
    },
    {
      info: { code: "por", name: "Portuguese", badge: "POR" },
      textRegex: /(?:\b(?:por|portuguese|portugues|português|brasil|sportv(?:\s*\d+)?\s*br)\b|🇧🇷|🇵🇹)/iu,
      urlRegex: /(?:\/|-|_)(?:por|portuguese|pt-br)(?:\/|-|_|\.)/i,
    },
    {
      info: { code: "deu", name: "German", badge: "DEU" },
      textRegex: /(?:\b(?:deu|ger|german|deutsch|sport\s*1\s*de)\b|🇩🇪|🇦🇹)/iu,
      urlRegex: /(?:\/|-|_)(?:deu|ger|german)(?:\/|-|_|\.)/i,
    },
    {
      info: { code: "ita", name: "Italian", badge: "ITA" },
      textRegex: /(?:\b(?:ita|italian|italiano|sky\s*italia)\b|🇮🇹)/iu,
      urlRegex: /(?:\/|-|_)(?:ita|italian)(?:\/|-|_|\.)/i,
    },
    {
      info: { code: "rus", name: "Russian", badge: "RUS" },
      textRegex: /(?:\b(?:rus|russian|russia\s+feed)\b|🇷🇺)/iu,
      urlRegex: /(?:\/|-|_)(?:rus|russian)(?:\/|-|_|\.)/i,
    },
  ];

  /**
   * Identifies donation spam, promotional banners, non-media API URLs, or invalid candidates.
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
    // Filter out non-media JSON API endpoints (e.g. kick.com/api/v2/channels/...) unless they wrap an .m3u8/.mpd
    if (
      /\/api\/v\d+\/channels\//i.test(url) &&
      !url.toLowerCase().includes(".m3u8") &&
      !url.toLowerCase().includes(".mpd")
    ) {
      return {
        reason: "NON_MEDIA_URL",
        provider: item.providerKey,
        details: `Non-playable JSON API endpoint: ${url.slice(0, 60)}`,
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
   * Extracts the direct origin manifest URL when a stream is wrapped inside a MediaFlow / HLS decryptor bridge (?d=https://...).
   */
  static extractDirectOriginUrl(url: string): string | null {
    try {
      const u = new URL(url);
      const nested = u.searchParams.get("d");
      if (nested && (nested.startsWith("http://") || nested.startsWith("https://"))) {
        return nested;
      }
    } catch {}
    return null;
  }

  /**
   * Normalizes URL for fingerprint comparison:
   * Strips dynamic tokens, Akamai/CloudFront edge auth tokens, nonces, and timestamp tracking parameters,
   * while STRICTLY preserving quality variants (e.g. maxh=1080 vs maxh=720) and DRM keys so
   * distinct resolution renditions and mirrors are never falsely collapsed.
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
      // Remove ephemeral tracking / CDN edge-auth query parameters and sort deterministically
      const cleanEntries: [string, string][] = [];
      for (const [k, v] of u.searchParams.entries()) {
        const lowerKey = k.toLowerCase();
        if (
          !lowerKey.includes("token") &&
          !lowerKey.includes("expires") &&
          !lowerKey.includes("session") &&
          !lowerKey.includes("auth") &&
          !lowerKey.includes("sig") &&
          !lowerKey.includes("hmac") &&
          lowerKey !== "hdnea" &&
          lowerKey !== "hdnts" &&
          lowerKey !== "policy" &&
          lowerKey !== "key-pair-id" &&
          lowerKey !== "md5" &&
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
    const dimMatch = t.match(/\b(\d{3,4})x(\d{3,4})\b/);
    if (dimMatch) {
      const h = parseInt(dimMatch[2], 10);
      if (h >= 2160) return "4K";
      if (h > 0) return `${h}p`;
    }
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
      url.includes("tamashaweb.com") ||
      url.includes("akamaized.net") ||
      url.includes("slivcdn.com")
    ) {
      score += 0.10;
    }
    const finalScore = Math.min(0.99, Number(score.toFixed(2)));
    const tier: "high" | "medium" | "standard" =
      finalScore >= 0.85 ? "high" : finalScore >= 0.75 ? "medium" : "standard";
    return { confidence: finalScore, tier };
  }

  /**
   * Parses language code and badges from both stream title/name and URL path/query markers.
   */
  static extractLanguage(text: string, url?: string): LanguageInfo {
    const cleanText = text || "";
    const cleanUrl = url || "";

    // 1. Check title/name tokens first
    for (const rule of this.LANGUAGE_RULES) {
      if (rule.textRegex.test(cleanText)) {
        return rule.info;
      }
    }

    // 2. Check URL path / query language segments (e.g. /KAN/, /TEL/, /TAM/, /HIN/, -hin-, -tam-)
    if (cleanUrl) {
      for (const rule of this.LANGUAGE_RULES) {
        if (rule.urlRegex && rule.urlRegex.test(cleanUrl)) {
          return rule.info;
        }
      }
    }

    return { code: "eng", name: "English", badge: "ENG" };
  }

  /**
   * Cleans display title into a polished TV channel title (e.g. "Willow Cricket HD").
   */
  static cleanChannelName(rawName?: string, rawTitle?: string): { name: string; group: string } {
    return ChannelNormalizer.normalize(rawName, rawTitle);
  }

  /**
   * Determines stream priority tier based on quality variant and multi-source confidence.
   */
  static determinePriorityTier(
    qualityVariant: string,
    isMultiSource: boolean,
    channelName: string
  ): "primary" | "secondary" | "tertiary" {
    if (
      qualityVariant === "396p" ||
      qualityVariant === "360p" ||
      qualityVariant === "288p"
    ) {
      return "tertiary";
    }
    if (
      qualityVariant === "576p" ||
      qualityVariant === "540p" ||
      qualityVariant === "480p" ||
      channelName === "Standard Feed"
    ) {
      return "secondary";
    }
    if (
      qualityVariant === "4K" ||
      qualityVariant === "1080p" ||
      qualityVariant === "720p" ||
      qualityVariant === "Auto"
    ) {
      return isMultiSource || qualityVariant === "1080p" || qualityVariant === "4K" || qualityVariant === "720p" || qualityVariant === "Auto"
        ? "primary"
        : "secondary";
    }
    return "secondary";
  }

  private static qualitySortRank(qualityVariant?: string): number {
    switch (qualityVariant) {
      case "4K":
        return 100;
      case "1080p":
        return 90;
      case "Auto":
        return 85;
      case "720p":
        return 80;
      case "576p":
        return 60;
      case "540p":
        return 55;
      case "480p":
        return 50;
      case "396p":
        return 30;
      case "360p":
        return 25;
      case "288p":
        return 20;
      default:
        return 70;
    }
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
   * Merges identical URLs, upgrades metadata across providers, preserves separate quality renditions (1080p, 720p, etc.),
   * extracts language from title + URL path, parses DRM keys & direct origin URLs, and ranks streams by quality & reliability.
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
      const language = this.extractLanguage(combinedTitle, url);
      const { name: channelName, group: channelGroup } = this.cleanChannelName(
        item.name,
        item.title
      );
      const qualityVariant = this.extractQualityVariant(combinedTitle, url);
      const bitrate = this.extractBitrateBps(combinedTitle);
      const incomingDrm = DrmDetector.detectDrm(
        `${channelName} ${url} ${combinedTitle}`,
        item.clearkey
      );

      const providerDisplayName =
        this.PROVIDER_DISPLAY_NAMES[item.providerKey] ?? item.providerKey;

      const existing = fingerprintMap.get(fingerprint);
      if (existing) {
        // 1. Upgrade language if existing was default 'eng' and secondary provider had explicit language tag
        if (existing.language.code === "eng" && language.code !== "eng") {
          existing.language = language;
        }

        // 2. Upgrade channel identity if existing was generic "Standard Feed" or "General Sports"
        if (
          (existing.channelName === "Standard Feed" ||
            existing.channelGroup === "General Sports") &&
          channelGroup !== "General Sports"
        ) {
          existing.channelName = channelName;
          existing.channelGroup = channelGroup;
        }

        // 3. Upgrade qualityVariant & rendition if secondary provider provides higher explicit resolution or bitrate
        if (
          qualityVariant !== "Auto" &&
          this.qualitySortRank(qualityVariant) > this.qualitySortRank(existing.qualityVariant)
        ) {
          existing.qualityVariant = qualityVariant;
          const dims = this.RESOLUTION_DIMENSIONS[qualityVariant] || { width: 0, height: 0 };
          if (existing.renditions[0]) {
            existing.renditions[0].qualityTag = qualityVariant;
            existing.renditions[0].label = `${qualityVariant} (Adaptive)`;
            existing.renditions[0].height = dims.height;
            existing.renditions[0].width = dims.width;
          }
        }
        if (existing.renditions[0] && bitrate > existing.renditions[0].bitrate) {
          existing.renditions[0].bitrate = bitrate;
        }

        // 4. Upgrade DRM if existing lacked DRM or lacked ClearKey keys
        if (
          incomingDrm &&
          (!existing.drm || (!existing.drm.keys?.length && incomingDrm.keys?.length))
        ) {
          existing.drm = incomingDrm;
        }

        // 5. Merge any additional required headers from secondary provider
        const extraHeaders = this.extractHeaders(url, item.behaviorHints?.proxyHeaders?.request);
        if (existing.network.requiredHeaders) {
          for (const [hk, hv] of Object.entries(extraHeaders)) {
            if (
              hv &&
              (!existing.network.requiredHeaders[hk] ||
                (hk === "User-Agent" &&
                  existing.network.requiredHeaders[hk] ===
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"))
            ) {
              existing.network.requiredHeaders[hk] = hv;
            }
          }
          if (
            existing.playbackHints &&
            Boolean(
              existing.network.requiredHeaders["Referer"] ||
                existing.network.requiredHeaders["Origin"] ||
                existing.network.requiredHeaders["User-Agent"] !==
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
            )
          ) {
            existing.playbackHints.requiresCustomHeaders = true;
          }
        }

        // 6. Record provenance only if from a distinct secondary provider
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

        // Boost reliability if verified by multiple providers
        existing.reliabilityScore = Math.min(99, existing.reliabilityScore + 2);
        const updatedConfidence = this.calculateSourceConfidence(
          url,
          true,
          existing.drm !== null
        );
        existing.sourceConfidence = updatedConfidence.confidence;
        existing.confidenceTier = updatedConfidence.tier;
        existing.priorityTier = this.determinePriorityTier(
          existing.qualityVariant || "Auto",
          existing.provenance.isMultiSource,
          existing.channelName
        );
      } else {
        const streamId = `feed_${Math.abs(this.hashString(fingerprint)).toString(16)}`;
        const headers = this.extractHeaders(url, item.behaviorHints?.proxyHeaders?.request);
        const directOriginUrl = this.extractDirectOriginUrl(url);
        const isBridgedStream = Boolean(directOriginUrl);

        let pathname = "";
        try {
          pathname = new URL(url).pathname.toLowerCase();
        } catch {
          pathname = url.split("?")[0].toLowerCase();
        }

        const isHlsPath = pathname.endsWith(".m3u8") || url.toLowerCase().includes(".m3u8");
        const isMp4Path = pathname.endsWith(".mp4");
        const isDash =
          !isHlsPath &&
          (pathname.endsWith(".mpd") || url.includes(".mpd") || combinedTitle.includes("DASH"));
        const protocol: "hls" | "dash" | "mp4" = isMp4Path
          ? "mp4"
          : isDash
          ? "dash"
          : "hls";

        const drm = incomingDrm;

        const { confidence, tier } = this.calculateSourceConfidence(
          url,
          false,
          drm !== null
        );

        const dims = this.RESOLUTION_DIMENSIONS[qualityVariant] || { width: 0, height: 0 };
        const refererParam = headers["Referer"]
          ? `&referer=${encodeURIComponent(headers["Referer"])}`
          : "";
        const edgeProxyFallbackUrl = `/api/proxy?url=${encodeURIComponent(url)}${refererParam}`;
        const priorityTier = this.determinePriorityTier(
          qualityVariant,
          false,
          channelName
        );

        const isMpegTs =
          pathname.endsWith(".ts") || /[?&]extension=ts\b/i.test(url);
        const directDashAvailable =
          protocol === "dash" ||
          Boolean(directOriginUrl && directOriginUrl.toLowerCase().includes(".mpd"));
        const requiresClearKey = Boolean(drm && drm.type === "clearkey");
        const requiresCustomHeaders = Boolean(headers["Referer"] || headers["Origin"]);
        const webHlsCompatible =
          (protocol === "hls" && !isMpegTs && (!drm || isBridgedStream)) || isBridgedStream;

        fingerprintMap.set(fingerprint, {
          streamId,
          channelName,
          channelGroup,
          priorityTier,
          reliabilityScore: 92,
          sourceConfidence: confidence,
          confidenceTier: tier,
          qualityVariant,
          language,
          protocol,
          drm,
          network: {
            masterPlaylistUrl: url,
            ...(directOriginUrl ? { directOriginUrl, isBridgedStream: true } : {}),
            edgeProxyFallbackUrl,
            requiredHeaders: headers,
          },
          playbackHints: {
            webHlsCompatible,
            directDashAvailable,
            requiresClearKey,
            requiresCustomHeaders,
            recommendedPlayer: isMpegTs
              ? "mpegts.js"
              : protocol === "dash"
              ? "shaka-player"
              : protocol === "mp4"
              ? "native"
              : "hls.js",
          },
          provenance: {
            originProvider: item.providerKey,
            originProviderName: providerDisplayName,
            mirroredBy: [],
            isExclusive: true,
            isMultiSource: false,
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

    // Sort streams deterministically: Primary before Secondary before Tertiary, then by quality rank, then by reliabilityScore
    const tierRank = { primary: 3, secondary: 2, tertiary: 1 };
    const streams = Array.from(fingerprintMap.values()).sort((a, b) => {
      const tDiff = tierRank[b.priorityTier] - tierRank[a.priorityTier];
      if (tDiff !== 0) return tDiff;
      const qDiff =
        this.qualitySortRank(b.qualityVariant) - this.qualitySortRank(a.qualityVariant);
      if (qDiff !== 0) return qDiff;
      return b.reliabilityScore - a.reliabilityScore;
    });

    const audit: StreamAuditSummary = {
      totalRawStreams: rawStreams.length,
      validStreamsCount: streams.length,
      excludedStreamsCount: exclusions.length,
      exclusions,
    };

    return { streams, audit };
  }

  /**
   * Builds structured ChannelMirrorGroup summaries grouping streams by (channelName, language.code)
   * so clients can inspect all available resolutions and CDN mirrors per broadcast channel.
   */
  static buildMirrorGroups(streams: UnifiedStream[]): ChannelMirrorGroup[] {
    const groupsMap = new Map<
      string,
      {
        channelName: string;
        channelGroup: string;
        language: LanguageInfo;
        recommendedStreamId: string;
        providersSet: Set<string>;
        qualitiesSet: Set<string>;
        hasDrm: boolean;
        streamIds: string[];
      }
    >();

    for (const s of streams) {
      const key = `${s.channelName}::${s.language.code}`;
      let entry = groupsMap.get(key);
      if (!entry) {
        entry = {
          channelName: s.channelName,
          channelGroup: s.channelGroup,
          language: s.language,
          recommendedStreamId: s.streamId,
          providersSet: new Set<string>(),
          qualitiesSet: new Set<string>(),
          hasDrm: s.drm !== null,
          streamIds: [],
        };
        groupsMap.set(key, entry);
      }

      entry.streamIds.push(s.streamId);
      entry.qualitiesSet.add(s.qualityVariant || "Auto");
      if (s.drm !== null) entry.hasDrm = true;
      for (const src of s.provenance.sourceList) {
        entry.providersSet.add(src.providerKey);
      }
    }

    return Array.from(groupsMap.values()).map((g) => ({
      channelName: g.channelName,
      channelGroup: g.channelGroup,
      language: g.language,
      recommendedStreamId: g.recommendedStreamId,
      totalMirrors: g.streamIds.length,
      providers: Array.from(g.providersSet),
      qualities: Array.from(g.qualitiesSet),
      hasDrm: g.hasDrm,
      streamIds: g.streamIds,
    }));
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
