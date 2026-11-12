import { DrmConfiguration, ClearKeyEntry } from "../types/stream.types";

export class DrmDetector {
  /**
   * Inspects stream URL, title, manifest headers, and explicit upstream clearkey properties to detect DRM.
   * Supports single and multi-key ClearKey configurations, URL-encoded keys, and Widevine indicators.
   */
  static detectDrm(text: string, explicitClearkey?: string): DrmConfiguration | null {
    if (explicitClearkey && typeof explicitClearkey === "string") {
      const parsedKeys = this.parseClearKeyString(explicitClearkey.trim());
      if (parsedKeys.length > 0) {
        return {
          type: "clearkey",
          keys: parsedKeys,
        };
      }
    }

    if (!text) return null;
    let decoded = text;
    try {
      decoded = decodeURIComponent(text);
    } catch {}

    // Check URL query parameter clearkey=... if text contains a URL
    const urlMatch = decoded.match(/https?:\/\/\S+/i);
    if (urlMatch) {
      try {
        const u = new URL(urlMatch[0]);
        const ckParam = u.searchParams.get("clearkey");
        if (ckParam) {
          const parsedKeys = this.parseClearKeyString(ckParam);
          if (parsedKeys.length > 0) {
            return {
              type: "clearkey",
              keys: parsedKeys,
            };
          }
        }
      } catch {}
    }

    // Pattern 1: clearkey: <32-hex-kid>:<32-hex-key> or clearkey=<32-hex-kid>:<32-hex-key>
    const clearkeyRegex = /clearkey[:=]\s*([0-9a-fA-F]{32})[:=]([0-9a-fA-F]{32})/i;
    const match = decoded.match(clearkeyRegex);
    if (match) {
      return {
        type: "clearkey",
        keys: [
          {
            kid: match[1].toLowerCase(),
            key: match[2].toLowerCase(),
          },
        ],
      };
    }

    // Pattern 2: Multi-key JSON or keyId/kid & key parameters
    const kidKeyRegex = /(?:keyId|kid)=([0-9a-fA-F]{32}).*?(?:key)=([0-9a-fA-F]{32})/i;
    const match2 = decoded.match(kidKeyRegex);
    if (match2) {
      return {
        type: "clearkey",
        keys: [
          {
            kid: match2[1].toLowerCase(),
            key: match2[2].toLowerCase(),
          },
        ],
      };
    }

    // Pattern 3: Generic ClearKey indicator
    if (decoded.toLowerCase().includes("clearkey")) {
      return {
        type: "clearkey",
      };
    }

    // Pattern 4: Widevine DRM indicator
    if (/\bwidevine\b/i.test(decoded)) {
      return {
        type: "widevine",
      };
    }

    return null;
  }

  private static parseClearKeyString(raw: string): ClearKeyEntry[] {
    const entries: ClearKeyEntry[] = [];
    const pairs = raw.split(/[,;]+/);
    for (const pair of pairs) {
      const parts = pair.trim().split(/[:=]/);
      if (
        parts.length === 2 &&
        /^[0-9a-fA-F]{32}$/.test(parts[0]) &&
        /^[0-9a-fA-F]{32}$/.test(parts[1])
      ) {
        entries.push({
          kid: parts[0].toLowerCase(),
          key: parts[1].toLowerCase(),
        });
      }
    }
    return entries;
  }
}
