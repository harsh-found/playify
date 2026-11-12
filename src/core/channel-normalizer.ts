/**
 * Intelligent Channel Normalizer for Cloudflare Edge Worker.
 * Sanitizes scraper junk, emojis, technical bitrate tokens, and normalizes
 * stream titles into pristine canonical broadcast network names.
 */
export class ChannelNormalizer {
  // Regex matching all emoji blocks, country flags, symbols, and zero-width/directional marks
  private static EMOJI_REGEX =
    /[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}-\u{206F}\u{FE0F}\u{FEFF}]/gu;

  // Regex matching technical resolution and bitrate tokens
  private static TECHNICAL_TOKEN_REGEX =
    /\b(?:direct\s*\d*p|direct|\d+p|\d+k|~?[\d.]+\s*(?:mbps|kbps)|uhd|fhd|hd|sd|aq|alt|adfree|ad-free)\b/gi;

  private static SPAM_TRAILER_REGEX =
    /(?:buffer-free|join\s+telegram|t\.me\/|cncverse\s+bridge|stream\s+provided\s+by|donate|paypal|patreon|audio:\s*\w+|\(plays\s+in\s+mpv\)|\(recommended\)).*$/gim;

  private static PROVIDER_NOISE_REGEX =
    /\b(?:sportzx|playztv|livxow|sktech|playfy|cricify)\s*(?:provider)?\b/gi;

  /**
   * Normalizes raw stream name and title into a polished, canonical broadcast identity.
   */
  static normalize(rawName?: string, rawTitle?: string): { name: string; group: string } {
    const fullText = (rawTitle || rawName || "").replace(this.EMOJI_REGEX, " ").trim();

    // 1. Line-Aware Channel Extraction: In Stremio scrapers (CNCVerse), the channel
    // identity line is explicitly prefixed with 🏷️ or contains the broadcaster label.
    let targetLine = "";
    const originalText = (rawTitle || rawName || "").trim();
    if (originalText.includes("\n")) {
      const lines = originalText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      // Prioritize line starting with 🏷️ (channel tag)
      const tagLine = lines.find((l) => l.includes("🏷️") || l.startsWith("🏷"));
      if (tagLine) {
        targetLine = tagLine.replace(/^🏷️?\s*/u, "");
      } else {
        // Find line containing recognized broadcaster keywords
        const broadcasterLine = lines.find((l) =>
          /\b(sky|sony|fancode|willow|star|supersport|bein|tnt|dazn|tapmad|ptv|eurosport|astro|tamasha|prime|icc\s*tv|espn|fox|tsn|sportsnet|jio|hotstar|redzone|nba|nhl|nfl|vix|sportv|eleven|spotv|sp0tv|auvio|sbs|apple\s*tv|ten\s*sport)\b/i.test(
            l
          )
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

    // 3. Strip all emojis, country flags, and invisible directional marks
    input = input.replace(this.EMOJI_REGEX, " ");

    // 4. Strip spam, bridge trailers, mpv notes, audio tags, and scraper provider prefixes
    input = input.replace(this.SPAM_TRAILER_REGEX, " ");
    input = input.replace(/\(plays\s+in\s+mpv\)/gi, " ");
    input = input.replace(this.PROVIDER_NOISE_REGEX, " ");

    // 5. Clean up special separators, empty brackets, & whitespace
    input = input
      .replace(/\[\s*\]|\(\s*\)/g, " ")
      .replace(/[•·|~:[\]]+/g, " ")
      .replace(/\s+-\s+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    // 6. Detect generic Server feeds BEFORE stripping technical tokens
    const upperRaw = input.toUpperCase();
    if (
      upperRaw === "SD SERVER" ||
      upperRaw === "HD SERVER" ||
      upperRaw === "LOW SERVER" ||
      upperRaw === "LOW QUALITY" ||
      upperRaw === "BACKUP SERVER" ||
      upperRaw === "SERVER" ||
      upperRaw === "LIVE" ||
      upperRaw === "SK LIVE" ||
      upperRaw.startsWith("SD SERVER") ||
      upperRaw.startsWith("LOW SERVER") ||
      upperRaw.startsWith("SERVER ")
    ) {
      return { name: "Standard Feed", group: "General Sports" };
    }

    // 7. Strip technical tokens (e.g. "Direct 396p", "~0.5 Mbps", "1080p", "AQ", "ADFREE")
    input = input.replace(this.TECHNICAL_TOKEN_REGEX, " ").trim();
    input = input.replace(/\s+/g, " ").trim();

    const upper = input.toUpperCase();

    if (
      upper === "SD SERVER" ||
      upper === "HD SERVER" ||
      upper === "LOW SERVER" ||
      upper === "LOW QUALITY" ||
      upper === "LOW" ||
      upper === "SERVER" ||
      upper === "LIVE" ||
      upper === "SK LIVE" ||
      upper.startsWith("SD SERVER") ||
      upper.startsWith("LOW SERVER") ||
      upper.startsWith("SERVER ") ||
      /^(?:sd\s+server|hd\s+server|low\s+server|low\s+quality|server|live)$/i.test(upper)
    ) {
      return { name: "Standard Feed", group: "General Sports" };
    }

    // --- Apple TV+ (check before Sky so "Sky via Apple TV" maps to Apple TV+) ---
    if (upper.includes("APPLE TV")) {
      return { name: "Apple TV+", group: "Apple TV+" };
    }

    // --- Sony Sports Network (check SONY before SKY so "SONY SKY FEED" maps to Sony) ---
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

    // --- Ten Sports ---
    if (/\bTEN\s+SPORTS?\b/i.test(upper)) {
      return { name: "Ten Sports HD", group: "Ten Sports" };
    }

    // --- Sky Sports Network ---
    if (upper.includes("SKY") && (upper.includes("ITALIA") || /\bIT\b/.test(upper))) {
      return { name: "Sky Sport Italia", group: "Sky Sports" };
    }
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
    if (upper.includes("SKY") && upper.includes("MIX")) {
      return { name: "Sky Sports Mix", group: "Sky Sports" };
    }
    if (upper.includes("SKY SPORT") || upper.includes("SKY SPORTS")) {
      return { name: "Sky Sports HD", group: "Sky Sports" };
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

    // --- Star Sports & Disney+ Hotstar / JioCinema ---
    if (upper.includes("JIOCINEMA") || upper.includes("JIO CINEMA") || upper.includes("JIOHOTSTAR")) {
      return { name: "JioCinema", group: "JioCinema" };
    }
    if (upper.includes("HOTSTAR")) {
      return { name: "Disney+ Hotstar", group: "Star Sports" };
    }
    if (upper.includes("STAR") && upper.includes("HINDI")) {
      return { name: "Star Sports 1 Hindi", group: "Star Sports" };
    }
    if (upper.includes("STAR") && /\b(?:select\s*1|sel\s*1)\b/i.test(upper)) {
      return { name: "Star Sports Select 1", group: "Star Sports" };
    }
    if (upper.includes("STAR") && /\b(?:select\s*2|sel\s*2)\b/i.test(upper)) {
      return { name: "Star Sports Select 2", group: "Star Sports" };
    }
    if (upper.includes("STAR") && upper.includes("SELECT")) {
      return { name: "Star Sports Select HD", group: "Star Sports" };
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
      if (upper.includes("GRANDSTAND"))
        return { name: "SuperSport Grandstand", group: "SuperSport" };
      if (upper.includes("PREMIER"))
        return { name: "SuperSport Premier League", group: "SuperSport" };
      if (upper.includes("RUGBY")) return { name: "SuperSport Rugby", group: "SuperSport" };
      if (upper.includes("TENNIS")) return { name: "SuperSport Tennis", group: "SuperSport" };
      if (upper.includes("ACTION")) return { name: "SuperSport Action", group: "SuperSport" };
      if (upper.includes("FOOTBALL")) return { name: "SuperSport Football", group: "SuperSport" };
      if (upper.includes("VARIETY")) return { name: "SuperSport Variety", group: "SuperSport" };
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

    // --- Tapmad & Tamasha ---
    if (upper.includes("TAPMAD")) {
      return { name: "Tapmad Live", group: "Tapmad" };
    }
    if (upper.includes("TAMASHA")) {
      return { name: "Tamasha Live", group: "Tamasha" };
    }

    // --- Amazon Prime Video & ICC TV ---
    if (
      upper.includes("PRIME VIDEO") ||
      upper.includes("AMAZON PRIME") ||
      /\bPRIME(?:\s+(?:ENG|ENGLISH|HIN|HINDI|TAM|TAMIL|TEL|TELUGU|KAN|KANNADA|LIVE|SPORT|SPORTS))?\b/i.test(
        upper
      )
    ) {
      return { name: "Amazon Prime Video", group: "Amazon Prime" };
    }
    if (upper.includes("ICC TV") || upper.includes("ICC.TV")) {
      return { name: "ICC.tv", group: "ICC TV" };
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

    // --- US Major League Networks (NFL / NBA / NHL / Tennis Channel) ---
    if (upper.includes("REDZONE") || upper.includes("RED ZONE")) {
      return { name: "NFL RedZone", group: "NFL Network" };
    }
    if (/\bNFL\s*(?:LIVE|NETWORK|TV)?\b/.test(upper)) {
      return { name: "NFL Network", group: "NFL Network" };
    }
    if (upper.includes("LEAGUEPASS") || upper.includes("LEAGUE PASS")) {
      return { name: "NBA League Pass", group: "NBA TV" };
    }
    if (/\bNBA\s*(?:LIVE|TV|USA)?\b/.test(upper)) {
      return { name: "NBA TV", group: "NBA TV" };
    }
    if (/\bNHL\s*(?:LIVE|NETWORK|TV)?\b/.test(upper)) {
      return { name: "NHL Network", group: "NHL Network" };
    }
    if (upper.includes("TENNIS CHANNEL") || /^TENNIS\s*\d*$/.test(upper)) {
      return { name: "Tennis Channel", group: "Tennis Channel" };
    }

    // --- Global Sports Networks (ViX, SporTV, Eleven, SPOTV, Sport1, RTBF, SBS, Canal+) ---
    if (/\bVIX\b/.test(upper)) {
      return { name: "ViX Deportes", group: "ViX" };
    }
    if (upper.includes("SPORTV")) {
      if (/\b3\b/.test(upper)) return { name: "SporTV 3", group: "SporTV" };
      if (/\b2\b/.test(upper)) return { name: "SporTV 2", group: "SporTV" };
      return { name: "SporTV Brasil", group: "SporTV" };
    }
    if (upper.includes("ELEVEN SPORT")) {
      return { name: "Eleven Sports", group: "Eleven Sports" };
    }
    if (upper.includes("SPOTV") || upper.includes("SP0TV")) {
      return { name: "SPOTV HD", group: "SPOTV" };
    }
    if (/\bSPORT\s*1\b/.test(upper)) {
      return { name: "Sport1 Germany", group: "Sport1" };
    }
    if (upper.includes("AUVIO")) {
      return { name: "RTBF Auvio", group: "RTBF" };
    }
    if (upper.includes("SBS SPORT")) {
      return { name: "SBS Sports", group: "SBS Sports" };
    }
    if (/\bCANAL\s*(?:\+|5|SPORT)\b/.test(upper) || upper === "CANAL5") {
      return { name: "Canal+ Sport", group: "Canal+" };
    }

    // --- ESPN / Fox Sports / TSN / Sportsnet ---
    if (upper.includes("ESPN")) {
      if (upper.includes("PLUS") || upper.includes("ESPN+")) return { name: "ESPN+", group: "ESPN" };
      if (/\b2\b/.test(upper)) return { name: "ESPN 2", group: "ESPN" };
      return { name: "ESPN HD", group: "ESPN" };
    }
    if (upper.includes("FOX CRICKET") || (upper.includes("FOX") && upper.includes("501"))) {
      return { name: "Fox Cricket 501", group: "Fox Sports" };
    }
    if (upper.includes("FOX SPORT") || upper.includes("KAYO")) {
      return { name: "Fox Sports HD", group: "Fox Sports" };
    }
    if (upper.includes("TSN")) {
      const m = upper.match(/\bTSN\s*([1-5])\b/);
      return { name: m ? `TSN ${m[1]}` : "TSN HD", group: "TSN" };
    }
    if (upper.includes("SPORTSNET")) {
      return { name: "Sportsnet HD", group: "Sportsnet" };
    }

    // Fallback: title-case generic clean name
    let generic = input
      .replace(/\b(?:direct|stream|server\s*\d+|feed\s*\d+|bridge)\b/gi, "")
      .replace(/[()[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!generic || generic.length < 3) {
      generic = rawName ? rawName.replace(this.EMOJI_REGEX, "").trim() : "Main Live Feed";
      generic = generic
        .replace(this.PROVIDER_NOISE_REGEX, "")
        .replace(this.TECHNICAL_TOKEN_REGEX, "")
        .replace(/[()[\]]/g, "")
        .trim();
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

