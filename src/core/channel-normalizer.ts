/**
 * Intelligent Channel Normalizer for Cloudflare Edge Worker.
 * Sanitizes scraper junk, emojis, technical bitrate tokens, and normalizes
 * stream titles into pristine canonical broadcast network names.
 */
export class ChannelNormalizer {
  // Regex matching all emoji blocks and symbols
  private static EMOJI_REGEX =
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{200D}\u{FE0F}]/gu;

  // Regex matching technical resolution and bitrate tokens
  private static TECHNICAL_TOKEN_REGEX =
    /\b(?:direct\s*\d*p|direct|\d+p|\d+k|~?[\d.]+\s*(?:mbps|kbps)|uhd|fhd|hd|sd)\b/gi;

  private static SPAM_TRAILER_REGEX =
    /(?:buffer-free|join\s+telegram|t\.me\/|cncverse\s+bridge|stream\s+provided\s+by|donate|paypal|patreon|audio:\s*\w+).*$/gim;

  /**
   * Normalizes raw stream name and title into a polished, canonical broadcast identity.
   */
  static normalize(rawName?: string, rawTitle?: string): { name: string; group: string } {
    const fullText = (rawTitle || rawName || "").trim();

    // 1. Line-Aware Channel Extraction: In Stremio scrapers (CNCVerse), the channel
    // identity line is explicitly prefixed with 🏷️ or contains the broadcaster label.
    let targetLine = "";
    if (fullText.includes("\n")) {
      const lines = fullText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      // Prioritize line starting with 🏷️ (channel tag)
      const tagLine = lines.find((l) => l.includes("🏷️") || l.startsWith("🏷"));
      if (tagLine) {
        targetLine = tagLine.replace(/^🏷️?\s*/u, "");
      } else {
        // Find line containing recognized broadcaster keywords
        const broadcasterLine = lines.find((l) =>
          /\b(sky|sony|fancode|willow|star|supersport|bein|tnt|dazn|tapmad|ptv|eurosport|astro)\b/i.test(l)
        );
        if (broadcasterLine) {
          targetLine = broadcasterLine;
        } else {
          // Exclude lines with 🍿 (event title), 🎞️ (protocol/res), 🛰️ (source), 🙊 (subtitles)
          const nonNoiseLine = lines.find((l) => !/^[🍿🎞️🛰️🙊✅❤️]/u.test(l));
          targetLine = nonNoiseLine || lines[0] || "";
        }
      }
    } else {
      targetLine = fullText;
    }

    // 2. Remove URLs
    let input = targetLine.replace(/https?:\/\/\S+/gi, "");

    // 3. Strip all emojis
    input = input.replace(this.EMOJI_REGEX, " ");

    // 4. Strip spam, bridge trailers, audio tags
    input = input.replace(this.SPAM_TRAILER_REGEX, " ");

    // 5. Clean up special separators & whitespace
    input = input
      .replace(/[•·|~:]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // 6. Detect generic Server feeds BEFORE stripping technical tokens
    const upperRaw = input.toUpperCase();
    if (
      upperRaw === "SD SERVER" ||
      upperRaw === "HD SERVER" ||
      upperRaw === "SERVER" ||
      upperRaw.startsWith("SD SERVER") ||
      upperRaw.startsWith("SERVER ")
    ) {
      return { name: "Standard Feed", group: "General Sports" };
    }

    // 7. Strip technical tokens (e.g. "Direct 396p", "~0.5 Mbps", "1080p")
    input = input.replace(this.TECHNICAL_TOKEN_REGEX, " ").trim();
    input = input.replace(/\s+/g, " ").trim();

    const upper = input.toUpperCase();

    if (
      upper === "SD SERVER" ||
      upper === "HD SERVER" ||
      upper === "SERVER" ||
      upper.startsWith("SD SERVER") ||
      upper.startsWith("SERVER ") ||
      /^(?:sd\s+server|hd\s+server|server)$/i.test(upper)
    ) {
      return { name: "Standard Feed", group: "General Sports" };
    }

    // --- Sky Sports Network ---
    if (upper.includes("SKY") && (upper.includes("TOP EVENT") || upper.includes("MAIN EVENT"))) {
      return { name: "Sky Sports Main Event", group: "Sky Sports" };
    }
    if (upper.includes("SKY") && upper.includes("CRICKET")) {
      return { name: "Sky Sports Cricket", group: "Sky Sports" };
    }
    if (upper.includes("SKY") && upper.includes("FOOTBALL")) {
      return { name: "Sky Sports Football", group: "Sky Sports" };
    }
    if (upper.includes("SKY") && (upper.includes("F1") || upper.includes("FORMULA 1"))) {
      return { name: "Sky Sports F1", group: "Sky Sports" };
    }
    if (upper.includes("SKY") && upper.includes("TENNIS")) {
      return { name: "Sky Sports Tennis", group: "Sky Sports" };
    }
    if (upper.includes("SKY") && upper.includes("PREMIER")) {
      return { name: "Sky Sports Premier League", group: "Sky Sports" };
    }
    if (upper.includes("SKY") && upper.includes("GOLF")) {
      return { name: "Sky Sports Golf", group: "Sky Sports" };
    }
    if (upper.includes("SKY") && upper.includes("ACTION")) {
      return { name: "Sky Sports Action", group: "Sky Sports" };
    }
    if (upper.includes("SKY") && upper.includes("ARENA")) {
      return { name: "Sky Sports Arena", group: "Sky Sports" };
    }
    if (upper.includes("SKY SPORT") || upper.includes("SKY SPORTS")) {
      return { name: "Sky Sports HD", group: "Sky Sports" };
    }

    // --- Sony Sports Network ---
    if (upper.includes("SONY") && (upper.includes("LIV") || upper.includes("SONYLIV"))) {
      return { name: "Sony LIV", group: "Sony Sports Network" };
    }
    if (/\b(?:ten\s*1|sony\s*ten\s*1)\b/i.test(upper)) {
      return { name: "Sony Sports Ten 1", group: "Sony Sports Network" };
    }
    if (/\b(?:ten\s*2|sony\s*ten\s*2)\b/i.test(upper)) {
      return { name: "Sony Sports Ten 2", group: "Sony Sports Network" };
    }
    if (/\b(?:ten\s*3|sony\s*ten\s*3)\b/i.test(upper)) {
      return { name: "Sony Sports Ten 3", group: "Sony Sports Network" };
    }
    if (/\b(?:ten\s*4|sony\s*ten\s*4)\b/i.test(upper)) {
      return { name: "Sony Sports Ten 4", group: "Sony Sports Network" };
    }
    if (/\b(?:ten\s*5|sony\s*(?:ten\s*5|six))\b/i.test(upper)) {
      return { name: "Sony Sports Ten 5", group: "Sony Sports Network" };
    }
    if (upper.includes("SONY")) {
      return { name: "Sony Sports HD", group: "Sony Sports Network" };
    }

    // --- FanCode ---
    if (upper.includes("FANCODE") || upper.includes("FAN CODE")) {
      return { name: "FanCode", group: "FanCode" };
    }

    // --- Willow ---
    if (
      upper.includes("WILLOW") &&
      (upper.includes("EXTRA") || upper.includes("XTRA") || /\b2\b/.test(upper))
    ) {
      return { name: "Willow Xtra", group: "Willow" };
    }
    if (upper.includes("WILLOW")) {
      return { name: "Willow Cricket HD", group: "Willow" };
    }

    // --- Star Sports ---
    if (upper.includes("STAR") && upper.includes("HINDI")) {
      return { name: "Star Sports 1 Hindi", group: "Star Sports" };
    }
    if (upper.includes("STAR") && /\b(?:select\s*1|sel\s*1)\b/i.test(upper)) {
      return { name: "Star Sports Select 1", group: "Star Sports" };
    }
    if (upper.includes("STAR") && /\b(?:select\s*2|sel\s*2)\b/i.test(upper)) {
      return { name: "Star Sports Select 2", group: "Star Sports" };
    }
    if (upper.includes("STAR") && /\b(?:1|1\s*hd)\b/i.test(upper)) {
      return { name: "Star Sports 1", group: "Star Sports" };
    }
    if (upper.includes("STAR") && /\b(?:2|2\s*hd)\b/i.test(upper)) {
      return { name: "Star Sports 2", group: "Star Sports" };
    }
    if (upper.includes("STAR SPORT")) {
      return { name: "Star Sports HD", group: "Star Sports" };
    }

    // --- SuperSport ---
    if (upper.includes("SUPERSPORT") || upper.includes("SUPER SPORT")) {
      if (upper.includes("CRICKET")) return { name: "SuperSport Cricket", group: "SuperSport" };
      if (upper.includes("GRANDSTAND")) return { name: "SuperSport Grandstand", group: "SuperSport" };
      if (upper.includes("PREMIER")) return { name: "SuperSport Premier League", group: "SuperSport" };
      if (upper.includes("RUGBY")) return { name: "SuperSport Rugby", group: "SuperSport" };
      if (upper.includes("TENNIS")) return { name: "SuperSport Tennis", group: "SuperSport" };
      return { name: "SuperSport HD", group: "SuperSport" };
    }

    // --- Astro ---
    if (upper.includes("ASTRO") && upper.includes("CRICKET")) {
      return { name: "Astro Cricket", group: "Astro" };
    }
    if (upper.includes("ASTRO")) {
      return { name: "Astro SuperSport", group: "Astro" };
    }

    // --- TNT Sports / BT Sport ---
    if (upper.includes("TNT") || upper.includes("BT SPORT")) {
      if (/\b1\b/.test(upper)) return { name: "TNT Sports 1", group: "TNT Sports" };
      if (/\b2\b/.test(upper)) return { name: "TNT Sports 2", group: "TNT Sports" };
      if (/\b3\b/.test(upper)) return { name: "TNT Sports 3", group: "TNT Sports" };
      if (/\b4\b/.test(upper)) return { name: "TNT Sports 4", group: "TNT Sports" };
      return { name: "TNT Sports HD", group: "TNT Sports" };
    }

    // --- Tapmad ---
    if (upper.includes("TAPMAD")) {
      return { name: "Tapmad Live", group: "Tapmad" };
    }

    // --- A Sports / PTV Sports / T Sports ---
    if (upper.includes("A SPORTS") || upper.includes("A-SPORTS")) {
      return { name: "A Sports HD", group: "A Sports" };
    }
    if (upper.includes("PTV")) {
      return { name: "PTV Sports", group: "PTV Sports" };
    }
    if (upper.includes("T SPORTS") || upper.includes("T-SPORTS")) {
      return { name: "T Sports HD", group: "T Sports" };
    }

    // --- Eurosport ---
    if (upper.includes("EUROSPORT")) {
      if (/\b1\b/.test(upper)) return { name: "Eurosport 1", group: "Eurosport" };
      if (/\b2\b/.test(upper)) return { name: "Eurosport 2", group: "Eurosport" };
      return { name: "Eurosport HD", group: "Eurosport" };
    }

    // --- beIN Sports ---
    if (upper.includes("BEIN")) {
      if (upper.includes("ENGLISH")) return { name: "beIN Sports English", group: "beIN Sports" };
      if (/\b1\b/.test(upper)) return { name: "beIN Sports 1", group: "beIN Sports" };
      if (/\b2\b/.test(upper)) return { name: "beIN Sports 2", group: "beIN Sports" };
      if (/\b3\b/.test(upper)) return { name: "beIN Sports 3", group: "beIN Sports" };
      return { name: "beIN Sports HD", group: "beIN Sports" };
    }

    // --- DAZN ---
    if (upper.includes("DAZN")) {
      if (/\b1\b/.test(upper)) return { name: "DAZN 1 HD", group: "DAZN" };
      if (/\b2\b/.test(upper)) return { name: "DAZN 2 HD", group: "DAZN" };
      return { name: "DAZN HD", group: "DAZN" };
    }

    // Fallback: title-case generic clean name
    let generic = input
      .replace(
        /\b(?:direct|stream|server\s*\d+|feed\s*\d+|bridge)\b/gi,
        ""
      )
      .replace(/\s+/g, " ")
      .trim();

    if (!generic || generic.length < 3) {
      generic = rawName ? rawName.replace(this.EMOJI_REGEX, "").trim() : "Main Live Feed";
      generic = generic.replace(this.TECHNICAL_TOKEN_REGEX, "").trim();
    }

    generic = generic
      .toLowerCase()
      .split(" ")
      .filter((w) => w.length > 0)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    return {
      name: generic || "Broadcast Channel",
      group: "General Sports",
    };
  }
}
