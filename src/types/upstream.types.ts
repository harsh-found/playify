export interface UpstreamFormatItem {
  title?: string;
  logo?: string | null;
  webLink?: string | null;
  [key: string]: any;
}

export interface UpstreamEventInfo {
  eventId?: number | string;
  teamA?: string;
  teamB?: string;
  teamAFlag?: string | null;
  teamBFlag?: string | null;
  eventCat?: string | null;
  eventName?: string | null;
  eventType?: string | null;
  eventLogo?: string | null;
  eventBanner?: string | null;
  isHot?: string | number | boolean | null;
  isPinned?: number | boolean | null;
  isLive?: boolean | number | string | null;
  isEnded?: boolean | number | string | null;
  startTime?: string | null;
  endTime?: string | null;
  [key: string]: any;
}

export interface UpstreamMeta {
  id: string;
  type?: string;
  name?: string;
  poster?: string;
  posterShape?: string;
  background?: string;
  behaviorHints?: Record<string, any>;
  [key: string]: any;
}

export interface UpstreamStream {
  url: string;
  name?: string;
  title?: string;
  clearkey?: string;
  behaviorHints?: {
    bingeGroup?: string;
    notWebReady?: boolean;
    filename?: string;
    proxyHeaders?: { request?: Record<string, string> };
    [key: string]: any;
  };
  [key: string]: any;
}

export interface CncDecodedPayload {
  provider?: string;
  data?: {
    eventId?: number | string;
    channelId?: string;
    slug?: string;
    title?: string;
    poster?: string;
    cat?: string;
    category?: string;
    formats?: Array<UpstreamFormatItem | string>;
    eventInfo?: UpstreamEventInfo;
    [key: string]: any;
  };
}

/**
 * Repairs common UTF-8 Latin-1 mojibake sequences (e.g. "TÃ¼rkiye" -> "Türkiye", "CÃ´te" -> "Côte").
 * Safely recovers original UTF-8 text when upstream strings were double-encoded as Latin-1.
 */
export function repairMojibake(input: string): string {
  if (!input || !/[ÃÂâ]/.test(input)) {
    return input;
  }

  try {
    // Convert Latin-1 code points (0x00-0xFF) back into raw bytes and decode as UTF-8
    const bytes = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      if (code > 255) {
        // Contains non-Latin-1 code points; fall back to targeted replacements
        return input
          .replace(/Ã¼/g, "ü")
          .replace(/Ãœ/g, "Ü")
          .replace(/Ã¶/g, "ö")
          .replace(/Ã–/g, "Ö")
          .replace(/Ã¤/g, "ä")
          .replace(/Ã„/g, "Ä")
          .replace(/Ã©/g, "é")
          .replace(/Ã‰/g, "É")
          .replace(/Ã¨/g, "è")
          .replace(/Ãª/g, "ê")
          .replace(/Ã«/g, "ë")
          .replace(/Ã¡/g, "á")
          .replace(/Ã /g, "à")
          .replace(/Ã¢/g, "â")
          .replace(/Ã£/g, "ã")
          .replace(/Ã¥/g, "å")
          .replace(/Ã§/g, "ç")
          .replace(/Ã‡/g, "Ç")
          .replace(/Ã³/g, "ó")
          .replace(/Ã²/g, "ò")
          .replace(/Ã´/g, "ô")
          .replace(/Ãµ/g, "õ")
          .replace(/Ãº/g, "ú")
          .replace(/Ã¹/g, "ù")
          .replace(/Ã»/g, "û")
          .replace(/Ã­/g, "í")
          .replace(/Ã¬/g, "ì")
          .replace(/Ã®/g, "î")
          .replace(/Ã¯/g, "ï")
          .replace(/Ã±/g, "ñ")
          .replace(/Ã‘/g, "Ñ")
          .replace(/ÃŸ/g, "ß");
      }
      bytes[i] = code;
    }
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    return decoded;
  } catch {
    return input;
  }
}

/**
 * Safely decodes base64 JSON payload embedded in CNCVerse IDs using full UTF-8 decoding.
 * Handles URL-safe base64 characters, missing padding, multi-byte UTF-8 sequences, and malformed strings.
 */
export function decodeCncRawId(rawId?: string): CncDecodedPayload {
  if (!rawId || typeof rawId !== "string" || !rawId.startsWith("cnc:")) {
    return {};
  }

  try {
    let b64 = rawId.slice(4).replace(/-/g, "+").replace(/_/g, "/");
    b64 += "=".repeat((4 - (b64.length % 4)) % 4);

    let decoded = "";
    if (typeof atob === "function") {
      const binaryStr = atob(b64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      decoded = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false }).decode(bytes);
    } else {
      const globalBuf = (
        globalThis as unknown as {
          Buffer?: { from: (s: string, enc: string) => { toString: (enc: string) => string } };
        }
      ).Buffer;
      if (globalBuf) {
        decoded = globalBuf.from(b64, "base64").toString("utf-8");
      } else {
        return {};
      }
    }

    decoded = repairMojibake(decoded);

    const parts = decoded.split("::");
    if (parts.length >= 2) {
      const provider = parts[0];
      const dataStr = parts.slice(1).join("::");
      const data = JSON.parse(dataStr);
      return { provider, data };
    }
  } catch {
    // Malformed base64 or non-JSON string
  }

  return {};
}

export interface CatalogExclusion {
  reason: "NON_OBJECT" | "MISSING_ID" | "INVALID_ARRAY";
  provider: string;
  details: string;
}

/**
 * Runtime validation for upstream catalog items (metas) with explicit exclusion audit tracking.
 * Never silently discards records: every rejected item is logged with a traceable reason.
 */
export function validateUpstreamMetasWithAudit(
  raw: unknown,
  providerKey = "unknown"
): {
  valid: UpstreamMeta[];
  exclusions: CatalogExclusion[];
  totalRaw: number;
} {
  if (!Array.isArray(raw)) {
    return {
      valid: [],
      exclusions:
        raw === undefined || raw === null
          ? []
          : [
              {
                reason: "INVALID_ARRAY",
                provider: providerKey,
                details: `Expected metas array but received ${typeof raw}`,
              },
            ],
      totalRaw: 0,
    };
  }

  const valid: UpstreamMeta[] = [];
  const exclusions: CatalogExclusion[] = [];

  for (let idx = 0; idx < raw.length; idx++) {
    const item = raw[idx];
    if (!item || typeof item !== "object") {
      exclusions.push({
        reason: "NON_OBJECT",
        provider: providerKey,
        details: `Catalog item at index ${idx} is ${item === null ? "null" : typeof item}`,
      });
      continue;
    }

    const rawId = (item as any).id;
    if (typeof rawId !== "string" || rawId.trim().length === 0) {
      exclusions.push({
        reason: "MISSING_ID",
        provider: providerKey,
        details: `Catalog item at index ${idx} (name="${String((item as any).name || "")}") has missing or empty string id`,
      });
      continue;
    }

    const meta = item as UpstreamMeta;
    if (typeof meta.name === "string") {
      meta.name = repairMojibake(meta.name);
    }
    valid.push(meta);
  }

  return {
    valid,
    exclusions,
    totalRaw: raw.length,
  };
}

/**
 * Runtime validation for upstream catalog items (metas).
 * Filters out null, non-objects, and entries without a valid string id, and repairs mojibake in names.
 */
export function validateUpstreamMetas(raw: unknown): UpstreamMeta[] {
  return validateUpstreamMetasWithAudit(raw).valid;
}

/**
 * Runtime validation for upstream stream candidates.
 * Filters out null, non-objects, and entries without a valid string URL.
 */
export function validateUpstreamStreams(raw: unknown): UpstreamStream[] {
  if (!Array.isArray(raw)) return [];

  const valid: UpstreamStream[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as any).url === "string" &&
      (item as any).url.trim().length > 0
    ) {
      const stream = item as UpstreamStream;
      if (typeof stream.title === "string") {
        stream.title = repairMojibake(stream.title);
      }
      if (typeof stream.name === "string") {
        stream.name = repairMojibake(stream.name);
      }
      valid.push(stream);
    }
  }
  return valid;
}
