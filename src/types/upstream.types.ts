export interface UpstreamMeta {
  id: string;
  type?: string;
  name?: string;
  poster?: string;
  background?: string;
  behaviorHints?: Record<string, any>;
  [key: string]: any;
}

export interface UpstreamStream {
  url: string;
  name?: string;
  title?: string;
  behaviorHints?: {
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
    title?: string;
    poster?: string;
    cat?: string;
    category?: string;
    formats?: Array<{ title?: string; [key: string]: any } | string>;
    eventInfo?: Record<string, any>;
    [key: string]: any;
  };
}

/**
 * Safely decodes base64 JSON payload embedded in CNCVerse IDs.
 * Handles URL-safe base64 characters, missing padding, and malformed strings.
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
      decoded = atob(b64);
    } else {
      const globalBuf = (globalThis as unknown as { Buffer?: { from: (s: string, enc: string) => { toString: (enc: string) => string } } }).Buffer;
      if (globalBuf) {
        decoded = globalBuf.from(b64, "base64").toString("utf-8");
      } else {
        return {};
      }
    }

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

/**
 * Runtime validation for upstream catalog items (metas).
 * Filters out null, non-objects, and entries without a valid string id.
 */
export function validateUpstreamMetas(raw: unknown): UpstreamMeta[] {
  if (!Array.isArray(raw)) return [];

  const valid: UpstreamMeta[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as any).id === "string" &&
      (item as any).id.trim().length > 0
    ) {
      valid.push(item as UpstreamMeta);
    }
  }
  return valid;
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
      valid.push(item as UpstreamStream);
    }
  }
  return valid;
}
