import { UnifiedFixture, FixtureKind, TeamEntity, TournamentEntity } from "../types/catalog.types";
import { EventIdentityEngine, EventIdentity } from "./event-identity";

export interface SportClassification {
  category: string;
  label: string;
  icon: string;
}

export class Normalizer {
  // Common sports team abbreviations & country code aliases
  private static TEAM_ALIASES: Record<string, string> = {
    ind: "India",
    india: "India",
    nz: "New Zealand",
    "new zealand": "New Zealand",
    pak: "Pakistan",
    pakistan: "Pakistan",
    sl: "Sri Lanka",
    "sri lanka": "Sri Lanka",
    ban: "Bangladesh",
    bangladesh: "Bangladesh",
    wi: "West Indies",
    "west indies": "West Indies",
    afg: "Afghanistan",
    afghanistan: "Afghanistan",
    zim: "Zimbabwe",
    zimbabwe: "Zimbabwe",
    aus: "Australia",
    australia: "Australia",
    eng: "England",
    england: "England",
    sa: "South Africa",
    "south africa": "South Africa",
    nep: "Nepal",
    nepal: "Nepal",
    uae: "United Arab Emirates",
    "united arab emirates": "United Arab Emirates",
    ned: "Netherlands",
    netherlands: "Netherlands",
    ire: "Ireland",
    ireland: "Ireland",
    sco: "Scotland",
    scotland: "Scotland",
    nam: "Namibia",
    namibia: "Namibia",
    omna: "Oman",
    oman: "Oman",
    can: "Canada",
    canada: "Canada",
    usa: "USA",
    "united states": "USA",
    "c. gane": "Ciryl Gane",
    "ciryl gane": "Ciryl Gane",
    "j. hokit": "Josh Hokit",
    "josh hokit": "Josh Hokit",
  };

  // Smart Sport Classifier Rules
  public static SPORT_RULES: Array<{
    category: string;
    label: string;
    icon: string;
    regex: RegExp;
  }> = [
    {
      category: "motorsport",
      label: "Motorsport",
      icon: "🏎️",
      regex: /\b(f1|formula\s*1|formula\s*one|grand\s*prix|motogp|moto\s*gp|nascar|indycar|rally|wrc|supercars|fe|formula\s*e)\b/i,
    },
    {
      category: "combat",
      label: "Combat Sports",
      icon: "🥊",
      regex: /\b(one\s*(?:friday\s*fights|fighting\s*championship|championship)|friday\s*fights|ufc|mma|boxing|boxer|wwe|raw|smackdown|nxt|aew|dynamite|rampage|collision|bellator|bkfc|pfl|glory|sumo|judo|karate|kickboxing|muay\s*thai|taekwondo|combat|bouts?|fight|gromda|mvpw)\b/i,
    },
    {
      category: "table_tennis",
      label: "Table Tennis",
      icon: "🏓",
      regex: /\b(table\s*tennis|ping\s*pong|ittf|wtt)\b/i,
    },
    {
      category: "tennis",
      label: "Tennis",
      icon: "🎾",
      regex: /\b(atp|wta|wimbledon|australian\s*open|french\s*open|us\s*open|roland\s*garros|tennis|davis\s*cup|laver\s*cup)\b/i,
    },
    {
      category: "basketball",
      label: "Basketball",
      icon: "🏀",
      regex: /\b(nba|wnba|euroleague|basketball|fiba|ncaa\s*basketball|cba|hawks|celtics|nets|hornets|bulls|cavaliers|mavericks|nuggets|pistons|warriors|rockets|pacers|clippers|lakers|grizzlies|heat|bucks|timberwolves|pelicans|knicks|thunder|magic|76ers|sixers|suns|trail\s*blazers|blazers|kings|spurs|raptors|jazz|wizards)\b/i,
    },
    {
      category: "hockey",
      label: "Ice Hockey",
      icon: "🏒",
      regex: /\b(nhl|ice\s*hockey|hockey|oilers|rangers|canucks|flyers|sharks|islanders|bruins|penguins|maple\s*leafs|canadiens|blackhawks|red\s*wings|avalanche|lightning|golden\s*knights|stars|hurricanes|predators|blues|wild|devils|capitals|sabres|senators|flames|ducks|kraken|coyotes)\b/i,
    },
    {
      category: "american_football",
      label: "American Football",
      icon: "🏈",
      regex: /\b(nfl|redzone|super\s*bowl|american\s*football|patriots|chiefs|eagles|cowboys|packers|49ers|steelers|dolphins|ravens|chargers|rams|bengals|seahawks|broncos|texans|colts|jaguars|commanders|cardinals|falcons|saints|panthers|titans|giants|jets|browns|raiders|bears|lions|vikings|bills)\b/i,
    },
    {
      category: "cricket",
      label: "Cricket",
      icon: "🏏",
      regex: /\b(cricket|t20|t10|ipl|bbl|wbbl|psl|cpl|npl|bpl|super\s*smash|odi|test\s*match|test\s*series|icc|ashes|ranji|smat|abu\s*dhabi\s*t10|nepal\s*premier\s*league|asia\s*cup|under-19|u19|world\s*test\s*championship|cricbuzz|crichd|cricify|smartcric)\b/i,
    },
    {
      category: "football",
      label: "Football",
      icon: "⚽",
      regex: /\b(ucl|uefa|champions\s*league|europa\s*league|conference\s*league|premier\s*league|epl|laliga|la\s*liga|serie\s*a|bundesliga|ligue\s*1|isl|football|soccer|fifa|afc\s*cup|facup|fa\s*cup|saff\s*(?:championship)?|copa|fc\b|cf\b|chelsea|arsenal|liverpool|real\s*madrid|barcelona|bayern|juventus|inter\b|milan\b|psg|atletico|dortmund|tottenham|napoli|roma\b|sabadell|sociedad|eldense|palmas|parkway|berkhamsted|h[aä]cken)\b/i,
    },
    {
      category: "badminton",
      label: "Badminton",
      icon: "🏸",
      regex: /\b(badminton|bwf|all\s*england|thomas\s*cup|uber\s*cup)\b/i,
    },
    {
      category: "kabaddi",
      label: "Kabaddi",
      icon: "🤼",
      regex: /\b(kabaddi|pkl|pro\s*kabaddi)\b/i,
    },
    {
      category: "rugby",
      label: "Rugby",
      icon: "🏉",
      regex: /\b(rugby|six\s*nations|top\s*14|premiership\s*rugby|super\s*rugby|urc|all\s*blacks|springboks|wallabies)\b/i,
    },
    {
      category: "volleyball",
      label: "Volleyball",
      icon: "🏐",
      regex: /\b(volleyball|fivb|cev|beach\s*volleyball|vnl)\b/i,
    },
    {
      category: "golf",
      label: "Golf",
      icon: "⛳",
      regex: /\b(golf|pga|liv\s*golf|ryder\s*cup|masters|us\s*open\s*golf|british\s*open|the\s*open)\b/i,
    },
    {
      category: "athletics",
      label: "Athletics",
      icon: "🏃",
      regex: /\b(athletics|diamond\s*league|world\s*athletics|marathon|100m|200m|400m)\b/i,
    },
    {
      category: "darts",
      label: "Darts",
      icon: "🎯",
      regex: /\b(darts|pdc|world\s*darts)\b/i,
    },
    {
      category: "snooker",
      label: "Snooker",
      icon: "🎱",
      regex: /\b(snooker|world\s*snooker|cue\s*sports)\b/i,
    },
    {
      category: "cycling",
      label: "Cycling",
      icon: "🚴",
      regex: /\b(cycling|tour\s*de\s*france|giro\s*d'italia|vuelta|uci)\b/i,
    },
  ];

  // Canonical Tournament & Show Clusters to unify cross-provider variations
  public static TOURNAMENT_CLUSTERS: Array<{
    canonicalKey: string;
    displayName: string;
    sportCategory: string;
    regex: RegExp;
  }> = [
    {
      canonicalKey: "cricket::nepal-premier-league::tournament",
      displayName: "Nepal Premier League (NPL)",
      sportCategory: "cricket",
      regex: /\b(nepal\s*premier\s*league|npl)\b/i,
    },
    {
      canonicalKey: "cricket::abu-dhabi-t10::tournament",
      displayName: "Abu Dhabi T10 League",
      sportCategory: "cricket",
      regex: /\b(abu\s*dhabi\s*t10|abu\s*dhabi\s*vs\s*t10|t10\s*league)\b/i,
    },
    {
      canonicalKey: "cricket::wbbl::tournament",
      displayName: "Women's Big Bash League (WBBL)",
      sportCategory: "cricket",
      regex: /\b(wbbl|womens\s*big\s*bash)\b/i,
    },
    {
      canonicalKey: "combat::one-fighting-championship::show",
      displayName: "ONE Fighting Championship",
      sportCategory: "combat",
      regex: /\b(one\s*(?:fighting\s*)?championship|one\s*friday\s*fights|friday\s*fights)\b/i,
    },
    {
      canonicalKey: "combat::wwe-raw::show",
      displayName: "WWE Monday Night Raw",
      sportCategory: "combat",
      regex: /\b(wwe\s*raw|monday\s*night\s*raw)\b/i,
    },
    {
      canonicalKey: "combat::wwe-smackdown::show",
      displayName: "WWE Friday Night SmackDown",
      sportCategory: "combat",
      regex: /\b(wwe\s*smackdown|friday\s*night\s*smackdown|smackdown)\b/i,
    },
    {
      canonicalKey: "combat::wwe-nxt::show",
      displayName: "WWE NXT",
      sportCategory: "combat",
      regex: /\b(wwe\s*nxt|nxt)\b/i,
    },
    {
      canonicalKey: "motorsport::formula-1::show",
      displayName: "Formula 1",
      sportCategory: "motorsport",
      regex: /\b(f1|formula\s*1|formula\s*one)\b/i,
    },
    {
      canonicalKey: "motorsport::motogp::show",
      displayName: "MotoGP",
      sportCategory: "motorsport",
      regex: /\b(motogp|moto\s*gp)\b/i,
    },
  ];

  /**
   * Cleans title strings: strips status emojis, leading symbols, and noise.
   */
  static cleanTitle(title: string): string {
    return title
      .replace(/^[🔴🔜✅⚡🍿✨📺🎬]+\s*/gu, "")
      .replace(/\s*[🔴🔜✅⚡🍿✨📺🎬]+\s*$/gu, "")
      .replace(/\b(LIVE|TODAY|UPCOMING)\b/gi, "")
      .replace(/•\s*CNCVerse\s*Bridge/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  public static CRICKET_NATIONS = new Set([
    "india", "pakistan", "australia", "england", "south africa",
    "new zealand", "west indies", "sri lanka", "bangladesh",
    "afghanistan", "zimbabwe", "ireland", "scotland", "netherlands",
    "nepal", "oman", "namibia", "uae"
  ]);

  /**
   * Extracts query parameters embedded inside card generator URLs.
   */
  static extractParamsFromPosterUrl(posterUrl?: string): {
    title?: string;
    teamA?: string;
    teamB?: string;
    time?: string;
    isLive?: boolean;
    isEnded?: boolean;
    eventLogo?: string;
    teamAImg?: string;
    teamBImg?: string;
  } {
    if (!posterUrl) return {};
    try {
      const u = new URL(posterUrl);
      const title = u.searchParams.get("title");
      const teamA = u.searchParams.get("teamA");
      const teamB = u.searchParams.get("teamB");
      const time = u.searchParams.get("time");
      const isLiveStr = u.searchParams.get("isLive");
      const isEndedStr = u.searchParams.get("isEnded");
      const eventLogo = u.searchParams.get("eventLogo");
      const teamAImg = u.searchParams.get("teamAImg");
      const teamBImg = u.searchParams.get("teamBImg");

      return {
        title: title ? decodeURIComponent(title).trim() : undefined,
        teamA: teamA ? decodeURIComponent(teamA).trim() : undefined,
        teamB: teamB ? decodeURIComponent(teamB).trim() : undefined,
        time: time ? decodeURIComponent(time).trim() : undefined,
        isLive: isLiveStr === "true",
        isEnded: isEndedStr === "true",
        eventLogo: eventLogo ? decodeURIComponent(eventLogo).trim() : undefined,
        teamAImg: teamAImg ? decodeURIComponent(teamAImg).trim() : undefined,
        teamBImg: teamBImg ? decodeURIComponent(teamBImg).trim() : undefined,
      };
    } catch {
      return {};
    }
  }

  /**
   * Expands abbreviation or returns normalized team title.
   * Handles U-19 age categories and standardizes club prefixes.
   */
  static normalizeTeamName(raw: string): string {
    if (!raw) return "";
    let cleaned = this.cleanTitle(raw).trim();
    // Standardize club prefixes: "UD Las Palmas" -> "Las Palmas", "CD Eldense" -> "Eldense", "CE Sabadell" -> "Sabadell"
    cleaned = cleaned.replace(/^(?:fc|cf|cd|ud|ce|ca|afc|bsc|sc)\s+/i, "").trim();
    const isU19 = /[-_\s]+(?:u-?19|under-?19)$/i.test(cleaned);
    if (isU19) {
      cleaned = cleaned.replace(/[-_\s]+(?:u-?19|under-?19)$/i, "").trim();
    }
    const key = cleaned.toLowerCase();
    const baseName = this.TEAM_ALIASES[key] ?? cleaned;
    return isU19 ? `${baseName} Under-19` : baseName;
  }

  /**
   * Classifies sport category based on keyword analysis overriding upstream errors.
   */
  static classifySport(title: string, rawSport?: string): SportClassification {
    // 1. First test title against SPORT_RULES (without rawSport so rawSport=Cricket does not pollute non-cricket titles)
    for (const rule of this.SPORT_RULES) {
      if (rule.regex.test(title)) {
        return { category: rule.category, label: rule.label, icon: rule.icon };
      }
    }

    // 2. Test rawSport if it gives specific sport
    if (rawSport && rawSport.toLowerCase() !== "tv" && rawSport.toLowerCase() !== "other") {
      const lower = rawSport.toLowerCase();
      if (lower.includes("foot") || lower.includes("soccer") || lower.includes("fa cup")) {
        const hasExplicitCricket = /\b(cricket|t20|t10|ipl|bbl|wbbl|psl|cpl|npl|bpl|odi|test\s*series|test\s*match|icc|ashes|ranji|smat)\b/i.test(title);
        if (!hasExplicitCricket) {
          return { category: "football", label: "Football", icon: "⚽" };
        }
      }
      if (lower.includes("basket") || lower === "nba") {
        return { category: "basketball", label: "Basketball", icon: "🏀" };
      }
      if (lower.includes("box") || lower.includes("fight") || lower.includes("ufc") || lower.includes("mma")) {
        return { category: "combat", label: "Combat Sports", icon: "🥊" };
      }
      if (lower.includes("hockey") || lower.includes("nhl")) {
        return { category: "hockey", label: "Ice Hockey", icon: "🏒" };
      }
      if (lower.includes("nfl") || lower.includes("american")) {
        return { category: "american_football", label: "American Football", icon: "🏈" };
      }
      if (lower.includes("tennis") || lower.includes("atp") || lower.includes("wta")) {
        return { category: "tennis", label: "Tennis", icon: "🎾" };
      }
      if (lower.includes("crick")) {
        // ONLY classify as cricket if the title actually contains cricket indicators or cricket country aliases
        const hasCricketKeywords = /\b(cricket|t20|t10|ipl|bbl|wbbl|psl|cpl|npl|bpl|odi|test|icc|ashes|ranji|smat|india|pakistan|australia|england|new\s*zealand|sri\s*lanka|south\s*africa|bangladesh|afghanistan|zimbabwe|west\s*indies|ind\b|pak\b|aus\b|eng\b|nz\b|sl\b|sa\b|ban\b|afg\b|zim\b|wi\b)\b/i.test(title);
        if (hasCricketKeywords) {
          return { category: "cricket", label: "Cricket", icon: "🏏" };
        }
        // If it was labeled "Cricket" by mistake upstream but has no cricket signals, default to football
        return { category: "football", label: "Football", icon: "⚽" };
      }
      return {
        category: lower.replace(/[^a-z0-9]/g, ""),
        label: rawSport,
        icon: "🏆",
      };
    }

    // 3. Test if title is an international cricket nation clash unless explicit football keyword
    const lowerTitle = title.toLowerCase();
    const isExplicitFootball = /\b(ucl|uefa|fifa|afc|saff|premier\s*league|europa|conference|soccer|football|copa|friendly\s*games|laliga|serie\s*a|bundesliga)\b/i.test(title);
    if (!isExplicitFootball) {
      let cricketNationHits = 0;
      for (const nation of this.CRICKET_NATIONS) {
        if (new RegExp(`\\b${nation}\\b`, "i").test(title)) {
          cricketNationHits++;
        }
      }
      if (cricketNationHits >= 2) {
        return { category: "cricket", label: "Cricket", icon: "🏏" };
      }
    }

    // Default 2-team matches or unknown events to Football, never Cricket!
    return { category: "football", label: "Football", icon: "⚽" };
  }

  /**
   * Extracts two teams from match title (e.g. "IND vs NZ", "New Zealand vs India").
   */
  static parseTeamsFromTitle(title: string): { teamA: string; teamB: string } | null {
    const cleaned = this.cleanTitle(title);
    const splitMatch = cleaned.split(/\s+(?:vs\.?|v)\s+/i);
    if (splitMatch.length >= 2) {
      const tA = this.normalizeTeamName(splitMatch[0].trim());
      const tB = this.normalizeTeamName(splitMatch[1].trim());
      if (tA && tB && tA.toLowerCase() !== tB.toLowerCase()) {
        return { teamA: tA, teamB: tB };
      }
    }
    return null;
  }

  /**
   * Helper to slugify team, tournament, or sport strings.
   */
  static slugify(str: string): string {
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /**
   * Normalizes any date string (ISO, "Nov 10, 2026", "10 Nov 2026") into YYYY-MM-DD.
   */
  static parseDateYmd(dateString?: string): string {
    if (!dateString) return "nodate";
    try {
      const clean = decodeURIComponent(dateString).trim();
      const iso = clean.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (iso) {
        return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
      }
      const months: Record<string, string> = {
        jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
        jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
      };
      const m1 = clean.match(/([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i);
      if (m1) {
        const mon = months[m1[1].toLowerCase().slice(0, 3)];
        if (mon) return `${m1[3]}-${mon}-${m1[2].padStart(2, "0")}`;
      }
      const m2 = clean.match(/(\d{1,2})\s+([a-z]{3})[a-z]*,?\s+(\d{4})/i);
      if (m2) {
        const mon = months[m2[2].toLowerCase().slice(0, 3)];
        if (mon) return `${m2[3]}-${mon}-${m2[1].padStart(2, "0")}`;
      }
    } catch {}
    return "nodate";
  }

  /**
   * Safely parses any date/time string into a normalized ISO 8601 UTC string.
   */
  static parseDateTimeIso(rawTime?: string): string {
    if (!rawTime) return new Date().toISOString();
    try {
      let clean = decodeURIComponent(rawTime).trim();
      if (/\bIST$/i.test(clean)) {
        clean = clean.replace(/\s*IST$/i, "") + " +05:30";
      } else if (/\bUTC$/i.test(clean) || /\bGMT$/i.test(clean)) {
        clean = clean.replace(/\s*(?:UTC|GMT)$/i, "") + " Z";
      } else if (/\s+[A-Za-z]{3,4}$/.test(clean)) {
        clean = clean.replace(/\s+[A-Za-z]{3,4}$/, "");
      }
      clean = clean.replace(/(\d{4})\/(\d{2})\/(\d{2})/, "$1-$2-$3");
      const d = new Date(clean);
      if (!isNaN(d.getTime())) {
        return d.toISOString();
      }
    } catch {}
    return new Date().toISOString();
  }

  /**
   * Generates a stable canonical fixture key for team-vs-team matches:
   * Sorts team names alphabetically so Home/Away reversal produces the exact same key.
   * Incorporates sport format, match number, and stage discriminators to prevent cross-series collisions.
   */
  static generateCanonicalKey(
    sportCategory: string,
    teamA: string,
    teamB: string,
    dateString?: string,
    discriminator?: string
  ): string {
    const s = this.slugify(sportCategory || "sport");
    const tA = this.slugify(this.normalizeTeamName(teamA));
    const tB = this.slugify(this.normalizeTeamName(teamB));

    // Alphabetical sort ensures order symmetry
    const [first, second] = [tA, tB].sort();
    const datePart = this.parseDateYmd(dateString);

    let session = "";
    if (dateString && (dateString.includes(":") || dateString.includes("T"))) {
      const d = new Date(this.parseDateTimeIso(dateString));
      if (!isNaN(d.getTime())) {
        const slot = Math.floor(d.getUTCHours() / 6);
        session = `::s${slot}`;
      }
    }

    const disc = discriminator ? `::${discriminator}` : "";
    return `${s}::${first}::${second}${disc}::${datePart}${session}`;
  }

  /**
   * Computes a unified canonical key for any incoming item across all 6 providers.
   * Seamlessly unifies tournament synonyms and match variations.
   */
  static computeCanonicalKey(
    name: string,
    rawSport: string,
    eventInfo?: Record<string, any>,
    posterUrl?: string
  ): string {
    const posterParams = this.extractParamsFromPosterUrl(posterUrl);
    const taCandidate = eventInfo?.teamA
      ? this.normalizeTeamName(eventInfo.teamA)
      : posterParams.teamA
      ? this.normalizeTeamName(posterParams.teamA)
      : "";
    const tbCandidate = eventInfo?.teamB
      ? this.normalizeTeamName(eventInfo.teamB)
      : posterParams.teamB
      ? this.normalizeTeamName(posterParams.teamB)
      : "";
    const combinedText = `${name} ${eventInfo?.eventName ?? ""} ${eventInfo?.eventType ?? ""} ${taCandidate} ${tbCandidate}`;
    const fullSearchText = `${combinedText} ${posterParams.title ?? ""} ${posterParams.teamA ?? ""} ${posterParams.teamB ?? ""}`;

    // 1. Check Tournament / Show Clusters
    for (const cluster of this.TOURNAMENT_CLUSTERS) {
      if (cluster.regex.test(fullSearchText)) {
        return cluster.canonicalKey;
      }
    }

    const sportClassification = this.classifySport(fullSearchText, rawSport);
    const eventDate = eventInfo?.startTime || posterParams.time || "";
    const identity = EventIdentityEngine.parse(fullSearchText, sportClassification.category);
    const disc = identity.canonicalDiscriminator;

    // 2. Check Team Match
    if (
      taCandidate &&
      tbCandidate &&
      taCandidate.toLowerCase() !== tbCandidate.toLowerCase() &&
      !this.isGenericTournamentName(taCandidate) &&
      !this.isGenericTournamentName(tbCandidate)
    ) {
      return this.generateCanonicalKey(sportClassification.category, taCandidate, tbCandidate, eventDate, disc);
    }

    const parsed = this.parseTeamsFromTitle(name);
    if (parsed) {
      return this.generateCanonicalKey(
        sportClassification.category,
        parsed.teamA,
        parsed.teamB,
        eventDate,
        disc
      );
    }

    // 3. Fallback to clean tournament or channel slug
    const cleanName = this.cleanTitle(posterParams.title || name);
    return `${sportClassification.category}::${this.slugify(cleanName)}::channel`;
  }

  /**
   * Checks if a title is generic noise.
   */
  static isGenericTournamentName(name: string, teamA?: string, teamB?: string): boolean {
    if (!name) return true;
    const lower = name.toLowerCase().trim();
    if (
      lower === "cricket" ||
      lower === "football" ||
      lower === "live events" ||
      lower === "test series" ||
      lower === "one day international" ||
      lower === "live sports" ||
      lower === "team a" ||
      lower === "team b"
    ) {
      return true;
    }
    if (teamA && teamB) {
      const matchPattern = `${teamA.toLowerCase()} vs ${teamB.toLowerCase()}`;
      if (lower === matchPattern) return true;
    }
    return false;
  }

  /**
   * Cascades metadata from multiple provider representations of the same fixture.
   * Merges richest tournament name, best logos, flags, start time, and broadcaster previews.
   */
  static cascadeFixture(
    canonicalKey: string,
    candidates: {
      providerKey: string;
      rawId: string;
      name: string;
      sport: string;
      eventInfo?: Record<string, any>;
      poster?: string;
      formats?: Array<{ title?: string } | string>;
    }[]
  ): UnifiedFixture {
    let rawSport = "";
    let teamAName = "";
    let teamBName = "";
    let teamALogo = "";
    let teamBLogo = "";
    let tournamentName = "";
    let tournamentLogo = "";
    let posterCard = "";
    let bannerWide = "";
    let startTime = "";
    let endTime = "";
    let isLive = false;
    let posterTitle = "";
    let candidateEndedCount = 0;
    const broadcastersSet = new Set<string>();
    const providerPointers: Record<string, string> = {};

    for (const c of candidates) {
      providerPointers[c.providerKey] = c.rawId;

      if (c.sport && !rawSport) {
        rawSport = c.sport;
      }

      if (c.name.includes("🔴") || c.name.toLowerCase().includes("live")) {
        isLive = true;
      }

      if (c.poster) {
        if (!posterCard) posterCard = c.poster;
        const params = this.extractParamsFromPosterUrl(c.poster);
        if (params.title && !posterTitle) posterTitle = params.title;
        if (params.teamA && !teamAName) teamAName = this.normalizeTeamName(params.teamA);
        if (params.teamB && !teamBName) teamBName = this.normalizeTeamName(params.teamB);
        if (params.teamAImg && !teamALogo) teamALogo = params.teamAImg;
        if (params.teamBImg && !teamBLogo) teamBLogo = params.teamBImg;
        if (params.eventLogo && !tournamentLogo) tournamentLogo = params.eventLogo;
        if (params.time && !startTime) startTime = params.time;
        if (params.isLive) isLive = true;
        if (params.isEnded) candidateEndedCount++;
      }

      // Extract broadcasters from formats
      if (Array.isArray(c.formats)) {
        for (const f of c.formats) {
          const t = typeof f === "string" ? f : f?.title;
          if (t && !t.toLowerCase().includes("support") && !t.toLowerCase().includes("goal")) {
            const cleanBroadcaster = t.replace(/\s*-\s*(AQ|ALT|FHD|HD|SD).*/i, "").trim();
            if (cleanBroadcaster.length > 2) {
              broadcastersSet.add(cleanBroadcaster);
            }
          }
        }
      }

      const info = c.eventInfo ?? {};

      // Teams
      const ta = info.teamA ? this.normalizeTeamName(info.teamA) : "";
      const tb = info.teamB ? this.normalizeTeamName(info.teamB) : "";
      if (ta && ta.toLowerCase() !== "team a" && (!teamAName || ta.length > teamAName.length)) {
        teamAName = ta;
      }
      if (tb && tb.toLowerCase() !== "team b" && (!teamBName || tb.length > teamBName.length)) {
        teamBName = tb;
      }

      if (info.teamAFlag && !teamALogo) teamALogo = info.teamAFlag;
      if (info.teamBFlag && !teamBLogo) teamBLogo = info.teamBFlag;

      // Tournament Name
      const tName = info.eventName || info.eventType;
      if (tName && !this.isGenericTournamentName(tName, ta, tb)) {
        if (!tournamentName || tName.length > tournamentName.length) {
          tournamentName = tName;
        }
      }
      if (info.eventLogo && !tournamentLogo) tournamentLogo = info.eventLogo;

      // Start & End Time
      if (info.startTime && !startTime) startTime = info.startTime;
      if (info.endTime && !endTime) endTime = info.endTime;
      if (info.isEnded) candidateEndedCount++;
    }

    // Determine Sport Classification across all candidate signals
    const sampleText = `${candidates.map((c) => c.name).join(" ")} ${tournamentName} ${posterTitle} ${teamAName} ${teamBName}`;
    const sportClassification = this.classifySport(sampleText, rawSport);

    // Check if canonicalKey matches a canonical tournament/show cluster
    const cluster = this.TOURNAMENT_CLUSTERS.find(
      (tc) => tc.canonicalKey === canonicalKey || tc.regex.test(sampleText)
    );

    // Determine if this is a genuine 2-team Match or a Tournament Channel / Live Show
    let isMatch = false;
    if (
      teamAName &&
      teamBName &&
      teamAName.toLowerCase() !== teamBName.toLowerCase() &&
      !this.isGenericTournamentName(teamAName) &&
      !this.isGenericTournamentName(teamBName) &&
      !cluster
    ) {
      isMatch = true;
    } else {
      // Try parsing from title if not in cluster
      if (!cluster) {
        const parsed = this.parseTeamsFromTitle(candidates[0]?.name || "");
        if (
          parsed &&
          parsed.teamA.toLowerCase() !== parsed.teamB.toLowerCase() &&
          !this.isGenericTournamentName(parsed.teamA) &&
          !this.isGenericTournamentName(parsed.teamB)
        ) {
          teamAName = parsed.teamA;
          teamBName = parsed.teamB;
          isMatch = true;
        }
      }
    }

    // Kind Determination
    let kind: FixtureKind = "match";
    if (!isMatch) {
      if (
        sportClassification.category === "combat" ||
        sportClassification.category === "motorsport"
      ) {
        kind = "show";
      } else {
        kind = "tournament_channel";
      }
    }

    // Polished Title Determination
    let title = "";
    if (isMatch) {
      title = `${teamAName} vs ${teamBName}`;
      if (!tournamentName) {
        tournamentName = `${sportClassification.label} Live`;
      }
    } else {
      // It's a tournament channel or show: NO "Team A vs Team B"!
      if (cluster) {
        title = cluster.displayName;
      } else if (posterTitle) {
        title = posterTitle;
      } else if (tournamentName && !this.isGenericTournamentName(tournamentName)) {
        title = tournamentName;
      } else {
        title = this.cleanTitle(candidates[0]?.name || `${sportClassification.label} Event`);
      }
      tournamentName = title;
    }

    // Standard ISO Start Time
    const startTimeIso = this.parseDateTimeIso(startTime);
    const startTimestamp = new Date(startTimeIso).getTime();
    const now = Date.now();

    // Check if match ended
    let isEnded = false;
    if (candidateEndedCount >= candidates.length && startTimestamp < now - 2 * 3600 * 1000) {
      isEnded = true;
    }
    if (endTime) {
      const endTimestamp = new Date(this.parseDateTimeIso(endTime)).getTime();
      if (!isNaN(endTimestamp) && endTimestamp < now - 30 * 60 * 1000) {
        isEnded = true;
      }
    }
    if (isLive) {
      isEnded = false; // Live always overrides ended
    }

    const phase = isLive ? "live" : isEnded ? "ended" : "upcoming";

    // Extract multi-dimensional event identity attributes
    const identity = EventIdentityEngine.parse(sampleText, sportClassification.category);
    const disc = identity.canonicalDiscriminator;

    // Stable Canonical Key and Fixture ID
    const finalCanonicalKey = isMatch
      ? this.generateCanonicalKey(sportClassification.category, teamAName, teamBName, startTimeIso, disc)
      : canonicalKey;
    const fixtureId = `fix_${this.slugify(finalCanonicalKey)}`;

    // Build Teams Entity ONLY for 2-team matches; null for channels/shows
    const teamsEntity = isMatch
      ? {
          home: {
            id: `team_${this.slugify(teamAName)}`,
            name: teamAName,
            code: teamAName.slice(0, 3).toUpperCase(),
            logo: teamALogo || posterCard,
          },
          away: {
            id: `team_${this.slugify(teamBName)}`,
            name: teamBName,
            code: teamBName.slice(0, 3).toUpperCase(),
            logo: teamBLogo || posterCard,
          },
        }
      : null;

    const broadcastInfo = !isMatch
      ? {
          eventName: title,
          badgeText: kind === "show" ? "LIVE SHOW" : "LEAGUE CHANNEL",
        }
      : undefined;

    return {
      fixtureId,
      canonicalKey: finalCanonicalKey,
      sport: sportClassification.label,
      sportCategory: sportClassification.category,
      phase,
      kind,
      isHotMatch: isLive || broadcastersSet.size >= 4,
      title,
      tournament: {
        id: `tourn_${this.slugify(tournamentName)}`,
        name: tournamentName,
        shortName: tournamentName.length > 25 ? `${tournamentName.slice(0, 22)}...` : tournamentName,
        stage: identity.stage,
        logo: tournamentLogo || posterCard,
        category: sportClassification.label,
      },
      teams: teamsEntity,
      broadcastInfo,
      schedule: {
        startTimeUtc: startTimeIso,
        status: isLive ? "live" : isEnded ? "ended" : "upcoming",
        liveBadgeText: isLive ? "LIVE NOW" : undefined,
        isLive,
      },
      artwork: {
        posterCard: posterCard || tournamentLogo,
        bannerWide: bannerWide || tournamentLogo || posterCard,
      },
      streamMetadata: {
        totalWorkingFeeds: broadcastersSet.size,
        availableLanguages: ["English", "Hindi"],
        maxResolution: "1080p FHD",
        primaryBroadcasters: Array.from(broadcastersSet).slice(0, 6),
      },
      eventDetails: {
        format: identity.format,
        matchNumber: identity.matchNumber,
        stage: identity.stage,
        gender: identity.gender,
        ageGroup: identity.ageGroup,
      },
      providerPointers,
    };
  }
}
