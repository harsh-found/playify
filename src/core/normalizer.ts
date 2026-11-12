import { UnifiedFixture, FixtureKind, TeamEntity, TournamentEntity } from "../types/catalog.types";
import { repairMojibake } from "../types/upstream.types";
import { EventIdentityEngine, EventIdentity } from "./event-identity";

export interface SportClassification {
  category: string;
  label: string;
  icon: string;
}

export class Normalizer {
  // Comprehensive international team abbreviations, IOC/FIFA/ICC country codes, and pro franchise aliases
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
    bd: "Bangladesh",
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
    rsa: "South Africa",
    "south africa": "South Africa",
    nep: "Nepal",
    nepal: "Nepal",
    uae: "United Arab Emirates",
    "united arab emirates": "United Arab Emirates",
    ned: "Netherlands",
    nld: "Netherlands",
    netherlands: "Netherlands",
    ire: "Ireland",
    ireland: "Ireland",
    sco: "Scotland",
    scotland: "Scotland",
    nam: "Namibia",
    namibia: "Namibia",
    omna: "Oman",
    omn: "Oman",
    oma: "Oman",
    oman: "Oman",
    can: "Canada",
    canada: "Canada",
    usa: "USA",
    "united states": "USA",
    tha: "Thailand",
    thailand: "Thailand",
    png: "Papua New Guinea",
    "papua new guinea": "Papua New Guinea",
    uga: "Uganda",
    uganda: "Uganda",
    ken: "Kenya",
    kenya: "Kenya",
    hkg: "Hong Kong",
    hk: "Hong Kong",
    "hong kong": "Hong Kong",
    mas: "Malaysia",
    malaysia: "Malaysia",
    kuw: "Kuwait",
    kuwait: "Kuwait",
    qat: "Qatar",
    qatar: "Qatar",
    bhr: "Bahrain",
    bahrain: "Bahrain",
    sgp: "Singapore",
    sin: "Singapore",
    singapore: "Singapore",
    ber: "Bermuda",
    bermuda: "Bermuda",
    jer: "Jersey",
    jersey: "Jersey",
    "c. gane": "Ciryl Gane",
    "ciryl gane": "Ciryl Gane",
    "j. hokit": "Josh Hokit",
    "josh hokit": "Josh Hokit",
    // Unambiguous NBA / NHL / NFL pro franchise mascot mappings
    "76ers": "Philadelphia 76ers",
    sixers: "Philadelphia 76ers",
    raptors: "Toronto Raptors",
    wizards: "Washington Wizards",
    pistons: "Detroit Pistons",
    timberwolves: "Minnesota Timberwolves",
    mavericks: "Dallas Mavericks",
    suns: "Phoenix Suns",
    hornets: "Charlotte Hornets",
    "trail blazers": "Portland Trail Blazers",
    blazers: "Portland Trail Blazers",
    celtics: "Boston Celtics",
    knicks: "New York Knicks",
    bulls: "Chicago Bulls",
    bucks: "Milwaukee Bucks",
    nuggets: "Denver Nuggets",
    clippers: "Los Angeles Clippers",
    grizzlies: "Memphis Grizzlies",
    pelicans: "New Orleans Pelicans",
    spurs: "San Antonio Spurs",
    jazz: "Utah Jazz",
    pacers: "Indiana Pacers",
    cavaliers: "Cleveland Cavaliers",
    cavs: "Cleveland Cavaliers",
    nets: "Brooklyn Nets",
    magic: "Orlando Magic",
    rockets: "Houston Rockets",
    bruins: "Boston Bruins",
    canadiens: "Montréal Canadiens",
    "montreal canadiens": "Montréal Canadiens",
    "blue jackets": "Columbus Blue Jackets",
    lightning: "Tampa Bay Lightning",
    "red wings": "Detroit Red Wings",
    devils: "New Jersey Devils",
    capitals: "Washington Capitals",
    "maple leafs": "Toronto Maple Leafs",
    wild: "Minnesota Wild",
    blackhawks: "Chicago Blackhawks",
    sabres: "Buffalo Sabres",
    kraken: "Seattle Kraken",
    mammoth: "Utah Mammoth",
    blues: "St. Louis Blues",
    islanders: "New York Islanders",
    ducks: "Anaheim Ducks",
    predators: "Nashville Predators",
    sharks: "San Jose Sharks",
    penguins: "Pittsburgh Penguins",
    canucks: "Vancouver Canucks",
    flames: "Calgary Flames",
    "golden knights": "Vegas Golden Knights",
    avalanche: "Colorado Avalanche",
    senators: "Ottawa Senators",
    flyers: "Philadelphia Flyers",
    commanders: "Washington Commanders",
    "49ers": "San Francisco 49ers",
    steelers: "Pittsburgh Steelers",
    dolphins: "Miami Dolphins",
    ravens: "Baltimore Ravens",
    chargers: "Los Angeles Chargers",
    bengals: "Cincinnati Bengals",
    seahawks: "Seattle Seahawks",
    broncos: "Denver Broncos",
    texans: "Houston Texans",
    colts: "Indianapolis Colts",
    jaguars: "Jacksonville Jaguars",
    falcons: "Atlanta Falcons",
    saints: "New Orleans Saints",
    browns: "Cleveland Browns",
    raiders: "Las Vegas Raiders",
    bears: "Chicago Bears",
    vikings: "Minnesota Vikings",
    bills: "Buffalo Bills",
    packers: "Green Bay Packers",
    cowboys: "Dallas Cowboys",
    patriots: "New England Patriots",
    // Football club aliases
    "cs puertollano": "Calvo Sotelo Puertollano",
    "calvo sotelo puertollano": "Calvo Sotelo Puertollano",
    "albacete balompie": "Albacete",
    "albacete balompié": "Albacete",
    "futbol club barcelona": "Barcelona",
    "fútbol club barcelona": "Barcelona",
    "cda navalcarnero": "Navalcarnero",
    "cd tarancon": "Tarancón",
    "cd tarancón": "Tarancón",
    "tarancon": "Tarancón",
    "levante ud": "Levante",
    "fk austria wien": "Austria Wien",
    "vfl wolfsburg": "Wolfsburg",
    "1. fc union berlin": "Union Berlin",
    "fc union berlin": "Union Berlin",
    "congo republic": "Congo",
    "republic of congo": "Congo",
    "bosnia & herzegovina": "Bosnia and Herzegovina",
  };

  // Smart Sport Classifier Rules
  // Ordered by domain specificity so franchise mascots never override explicit Cricket/Football/Hockey context
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
      regex:
        /\b(f1|formula\s*1|formula\s*one|grand\s*prix|motogp|moto\s*gp|nascar|indycar|rally|wrc|supercars|fe|formula\s*e)\b/i,
    },
    {
      category: "combat",
      label: "Combat Sports",
      icon: "🥊",
      regex:
        /\b(one\s*(?:friday\s*fights|fighting\s*championship|championship)|friday\s*fights|ufc|mma|mixed\s*martial\s*arts|oktagon|zuffa|queensberry|boxing|boxer|wwe|raw|smackdown|nxt|aew|dynamite|rampage|collision|bellator|bkfc|pfl|glory|sumo|judo|karate|kickboxing|muay\s*thai|taekwondo|combat|bouts?|fight|gromda|mvpw|wrestling)\b/i,
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
      regex:
        /\b(atp|wta|wimbledon|australian\s*open|french\s*open|us\s*open|roland\s*garros|indian\s*wells|stockholm\s*open|tennis|davis\s*cup|laver\s*cup)\b/i,
    },
    {
      category: "cricket",
      label: "Cricket",
      icon: "🏏",
      regex:
        /\b(cricket|t20i?|t10|ipl|bbl|wbbl|big\s*bash|wpl|psl|cpl|npl|bpl|super\s*smash|odi|one\s*day\s*international|test\s*match|test\s*series|test\s*championship|icc|ashes|ranji|smat|abu\s*dhabi\s*t10|nepal\s*premier\s*league|u19\s*asia\s*cup|emerging\s*nations\s*trophy|under-19|u19|world\s*test\s*championship|cricbuzz|crichd|cricify|smartcric|sydney\s*sixers|melbourne\s*stars|melbourne\s*renegades|brisbane\s*heat|perth\s*scorchers|hobart\s*hurricanes|adelaide\s*strikers|sydney\s*thunder)\b/i,
    },
    {
      category: "hockey",
      label: "Ice Hockey",
      icon: "🏒",
      regex:
        /\b(nhl|ice\s*hockey|hockey|oilers|rangers|canucks|flyers|sharks|islanders|bruins|penguins|maple\s*leafs|canadiens|blackhawks|red\s*wings|avalanche|lightning|golden\s*knights|stars|hurricanes|predators|blues|wild|devils|capitals|sabres|senators|flames|ducks|kraken|mammoth|coyotes|blue\s*jackets|winnipeg\s*jets|los\s*angeles\s*kings|florida\s*panthers)\b/i,
    },
    {
      category: "basketball",
      label: "Basketball",
      icon: "🏀",
      regex:
        /\b(nba|wnba|euroleague|basketball|fiba|ncaa\s*basketball|cba|hawks|celtics|nets|hornets|bulls|cavaliers|mavericks|nuggets|pistons|warriors|rockets|pacers|clippers|lakers|grizzlies|heat|bucks|timberwolves|pelicans|knicks|thunder|magic|76ers|sixers|suns|trail\s*blazers|blazers|sacramento\s*kings|kings|spurs|raptors|jazz|wizards)\b/i,
    },
    {
      category: "american_football",
      label: "American Football",
      icon: "🏈",
      regex:
        /\b(nfl|redzone|super\s*bowl|american\s*football|patriots|chiefs|eagles|cowboys|packers|49ers|steelers|dolphins|ravens|chargers|rams|bengals|seahawks|broncos|texans|colts|jaguars|commanders|cardinals|falcons|saints|panthers|titans|giants|jets|browns|raiders|bears|lions|vikings|bills)\b/i,
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
      regex:
        /\b(rugby|six\s*nations|top\s*14|premiership\s*rugby|super\s*rugby|urc|all\s*blacks|springboks|wallabies)\b/i,
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
      regex:
        /\b(golf|pga|liv\s*golf|ryder\s*cup|masters|us\s*open\s*golf|british\s*open|the\s*open)\b/i,
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
      regex: /\b(darts|pdc|world\s*darts|europe\s*super\s*league)\b/i,
    },
    {
      category: "snooker",
      label: "Snooker",
      icon: "🎱",
      regex: /\b(snooker|world\s*snooker|cue\s*sports|international\s*championship)\b/i,
    },
    {
      category: "cycling",
      label: "Cycling",
      icon: "🚴",
      regex: /\b(cycling|tour\s*de\s*france|giro\s*d'italia|vuelta|uci)\b/i,
    },
    {
      category: "football",
      label: "Football",
      icon: "⚽",
      regex:
        /\b(ucl|uefa|(?:uefa|concacaf)\s*nations\s*league|uefa\s*nations|afcon|africa\s*cup|concacaf|copa\s*del\s*rey|champions\s*league|europa\s*league|conference\s*league|premier\s*league|epl|laliga|la\s*liga|serie\s*a|bundesliga|ligue\s*1|isl|indian\s*super\s*league|football|soccer|fifa|fifa\s*friendlies|international\s*friendly|club\s*friendly|afc\s*cup|facup|fa\s*cup|saff\s*(?:championship)?|copa|femenino|golazo|fc\b|cf\b|chelsea|arsenal|liverpool|real\s*madrid|barcelona|bayern|juventus|inter\b|milan\b|psg|atletico|dortmund|tottenham|napoli|roma\b|sabadell|sociedad|eldense|palmas|parkway|berkhamsted|h[aä]cken|benfica|wolfsburg|betis|levante|albacete)\b/i,
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
      regex: /\b(wbbl|women'?s\s*big\s*bash)\b/i,
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
      regex: /\b(wwe\s*[:|-]?\s*raw|monday\s*night\s*raw)\b/i,
    },
    {
      canonicalKey: "combat::wwe-smackdown::show",
      displayName: "WWE Friday Night SmackDown",
      sportCategory: "combat",
      regex: /\b(wwe\s*[:|-]?\s*smackdown|friday\s*night\s*smackdown|smackdown)\b/i,
    },
    {
      canonicalKey: "combat::wwe-nxt::show",
      displayName: "WWE NXT",
      sportCategory: "combat",
      regex: /\b(wwe\s*[:|-]?\s*nxt|\bnxt\b)\b/i,
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
   * Cleans title strings: repairs UTF-8 mojibake, strips status emojis, leading symbols, and noise.
   */
  static cleanTitle(title: string): string {
    return repairMojibake(title || "")
      .replace(/^[🔴🔜✅⚡🍿✨📺🎬]+\s*/gu, "")
      .replace(/\s*[🔴🔜✅⚡🍿✨📺🎬]+\s*$/gu, "")
      .replace(/\b(LIVE|TODAY|UPCOMING)\b/gi, "")
      .replace(/•\s*CNCVerse\s*Bridge/gi, "")
      .replace(/\bFoc\*\*U\s+/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  public static CRICKET_NATIONS = new Set([
    "india",
    "pakistan",
    "australia",
    "england",
    "south africa",
    "new zealand",
    "west indies",
    "sri lanka",
    "bangladesh",
    "afghanistan",
    "zimbabwe",
    "ireland",
    "scotland",
    "netherlands",
    "nepal",
    "oman",
    "namibia",
    "uae",
    "united arab emirates",
    "thailand",
    "papua new guinea",
    "uganda",
    "kenya",
    "hong kong",
    "malaysia",
    "usa",
    "canada",
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
        title: title ? repairMojibake(decodeURIComponent(title).trim()) : undefined,
        teamA: teamA ? repairMojibake(decodeURIComponent(teamA).trim()) : undefined,
        teamB: teamB ? repairMojibake(decodeURIComponent(teamB).trim()) : undefined,
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
   * Handles Women (-W), U-19, U-21, U-23 age categories, club prefixes/suffixes, and pro franchises.
   */
  static normalizeTeamName(raw: string): string {
    if (!raw) return "";
    let cleaned = this.cleanTitle(raw).trim();

    // Detect Women suffix: e.g. "PAK-W", "NED-W", "Pakistan Women", "Sydney Sixers Women"
    let isWomen = false;
    if (/(?:[-_\s]+w|\s+women'?s?)$/i.test(cleaned)) {
      isWomen = true;
      cleaned = cleaned.replace(/(?:[-_\s]+w|\s+women'?s?)$/i, "").trim();
    }

    // Detect Age Group suffix: e.g. "PAK-U19", "India Under-19", "Iceland U21"
    let ageSuffix = "";
    if (/[-_\s]+(?:u-?19|under-?19)$/i.test(cleaned)) {
      ageSuffix = "Under-19";
      cleaned = cleaned.replace(/[-_\s]+(?:u-?19|under-?19)$/i, "").trim();
    } else if (/[-_\s]+(?:u-?21|under-?21)$/i.test(cleaned)) {
      ageSuffix = "U21";
      cleaned = cleaned.replace(/[-_\s]+(?:u-?21|under-?21)$/i, "").trim();
    } else if (/[-_\s]+(?:u-?23|under-?23)$/i.test(cleaned)) {
      ageSuffix = "U23";
      cleaned = cleaned.replace(/[-_\s]+(?:u-?23|under-?23)$/i, "").trim();
    }

    // Check direct alias before stripping club prefixes (e.g. "CS Puertollano", "1. FC Union Berlin")
    const directAlias = this.TEAM_ALIASES[cleaned.toLowerCase()];
    if (directAlias) {
      cleaned = directAlias;
    } else {
      // Standardize football club prefixes and suffixes
      cleaned = cleaned
        .replace(
          /^(?:1\.\s*fc|f[uú]tbol\s+club|vfl|vfb|tsg|fsv|cda|fk|sk|nk|hnk|gnk|fc|cf|cd|ud|ce|ca|afc|bsc|sc)\s+/i,
          ""
        )
        .replace(/\s+(?:fc|cf|ud|cd|sc|fk|sk|balompi[eé])$/i, "")
        .trim();

      const key = cleaned.toLowerCase();
      cleaned = this.TEAM_ALIASES[key] ?? cleaned;
    }

    if (isWomen && !/\bwomen\b/i.test(cleaned)) {
      cleaned = `${cleaned} Women`;
    }
    if (ageSuffix && !cleaned.toLowerCase().includes(ageSuffix.toLowerCase())) {
      cleaned = `${cleaned} ${ageSuffix}`;
    }

    return cleaned;
  }

  /**
   * Classifies sport category based on multi-signal keyword analysis overriding upstream errors.
   * Always returns one of the 18 canonical sport categories.
   */
  static classifySport(title: string, rawSport?: string): SportClassification {
    const cleanTitleStr = repairMojibake(title || "");
    const cleanRawSport = repairMojibake(rawSport || "");

    // 1. First test title against SPORT_RULES (without rawSport so rawSport=Cricket does not pollute non-cricket titles)
    for (const rule of this.SPORT_RULES) {
      if (rule.regex.test(cleanTitleStr)) {
        return { category: rule.category, label: rule.label, icon: rule.icon };
      }
    }

    // 2. Test rawSport if it gives a specific sport or tournament name (e.g. "AFCON", "UEFA Nations", "Mixed Martial Arts")
    if (
      cleanRawSport &&
      cleanRawSport.toLowerCase() !== "tv" &&
      cleanRawSport.toLowerCase() !== "other"
    ) {
      const lower = cleanRawSport.toLowerCase();

      // Check non-cricket SPORT_RULES against rawSport (handles AFCON, UEFA Nations, Copa del Rey, Mixed Martial Arts, etc.)
      if (!lower.includes("crick")) {
        for (const rule of this.SPORT_RULES) {
          if (rule.category !== "cricket" && rule.regex.test(cleanRawSport)) {
            if (rule.category === "football") {
              const hasExplicitCricket =
                /\b(cricket|t20|t10|ipl|bbl|wbbl|psl|cpl|npl|bpl|odi|test\s*series|test\s*match|icc|ashes|ranji|smat)\b/i.test(
                  cleanTitleStr
                );
              if (hasExplicitCricket) {
                return { category: "cricket", label: "Cricket", icon: "🏏" };
              }
            }
            return { category: rule.category, label: rule.label, icon: rule.icon };
          }
        }
      }

      if (
        lower.includes("foot") ||
        lower.includes("soccer") ||
        lower.includes("fa cup") ||
        lower.includes("afcon") ||
        lower.includes("nations") ||
        lower.includes("friendl") ||
        lower.includes("copa")
      ) {
        const hasExplicitCricket =
          /\b(cricket|t20|t10|ipl|bbl|wbbl|psl|cpl|npl|bpl|odi|test\s*series|test\s*match|icc|ashes|ranji|smat)\b/i.test(
            cleanTitleStr
          );
        if (!hasExplicitCricket) {
          return { category: "football", label: "Football", icon: "⚽" };
        }
      }
      if (lower.includes("basket") || lower === "nba") {
        return { category: "basketball", label: "Basketball", icon: "🏀" };
      }
      if (
        lower.includes("box") ||
        lower.includes("fight") ||
        lower.includes("ufc") ||
        lower.includes("mma") ||
        lower.includes("martial") ||
        lower.includes("wrestl")
      ) {
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
      if (
        lower.includes("crick") ||
        lower.includes("asia cup") ||
        /\b(t20i?|t10|odi|test|ipl|bbl|wbbl|wpl|psl|cpl|npl|bpl|wtc|icc|ashes|ranji|smat)\b/i.test(lower)
      ) {
        // Classify as cricket if title contains cricket indicators, cricket nations, or associate nations
        const hasCricketKeywords =
          /\b(cricket|t20|t10|ipl|bbl|wbbl|psl|cpl|npl|bpl|odi|test|icc|ashes|ranji|smat|emerging\s*nations|india|pakistan|australia|england|new\s*zealand|sri\s*lanka|south\s*africa|bangladesh|afghanistan|zimbabwe|west\s*indies|ireland|scotland|netherlands|nepal|oman|namibia|uae|united\s*arab\s*emirates|thailand|papua\s*new\s*guinea|uganda|kenya|hong\s*kong|ind\b|pak\b|aus\b|eng\b|nz\b|sl\b|sa\b|ban\b|afg\b|zim\b|wi\b|ned\b|tha\b|ire\b|sco\b|png\b|nep\b)\b/i.test(
            cleanTitleStr
          );
        const isExplicitFootball =
          /\b(ucl|uefa|fifa|afc|saff|afcon|concacaf|premier\s*league|europa|conference|soccer|football|copa|friendly\s*games|laliga|serie\s*a|bundesliga|femenino)\b/i.test(
            cleanTitleStr
          );
        if (hasCricketKeywords && !isExplicitFootball) {
          return { category: "cricket", label: "Cricket", icon: "🏏" };
        }
        return { category: "football", label: "Football", icon: "⚽" };
      }
    }

    // 3. Test if title is an international cricket nation clash unless explicit football keyword
    const isExplicitFootball =
      /\b(ucl|uefa|fifa|afc|saff|afcon|concacaf|premier\s*league|europa|conference|soccer|football|copa|friendly\s*games|laliga|serie\s*a|bundesliga|femenino)\b/i.test(
        cleanTitleStr
      );
    if (!isExplicitFootball) {
      let cricketNationHits = 0;
      for (const nation of this.CRICKET_NATIONS) {
        if (new RegExp(`\\b${nation}\\b`, "i").test(cleanTitleStr)) {
          cricketNationHits++;
        }
      }
      if (cricketNationHits >= 2) {
        return { category: "cricket", label: "Cricket", icon: "🏏" };
      }
    }

    // Default 2-team matches or unknown events to Football, never an arbitrary non-canonical slug!
    return { category: "football", label: "Football", icon: "⚽" };
  }

  /**
   * Extracts two teams from match title (e.g. "IND vs NZ", "New Zealand vs India").
   */
  static parseTeamsFromTitle(title: string): { teamA: string; teamB: string } | null {
    const cleaned = this.cleanTitle(title);
    // Do not treat prefixed event titles like "UFC 334: Gane vs Hokit" as raw teamA="UFC 334: Gane"
    if (/^(?:ufc|bellator|pfl|bkfc|oktagon|one|wwe|aew)\b.*?:/i.test(cleaned)) {
      const afterColon = cleaned.split(":").slice(1).join(":").trim();
      const splitAfter = afterColon.split(/\s+(?:vs\.?|v)\s+/i);
      if (splitAfter.length >= 2) {
        const tA = this.normalizeTeamName(splitAfter[0].trim());
        const tB = this.normalizeTeamName(splitAfter[1].trim());
        if (tA && tB && tA.toLowerCase() !== tB.toLowerCase()) {
          return { teamA: tA, teamB: tB };
        }
      }
    }
    const splitMatch = cleaned.split(/\s+(?:vs\.?|v)\s+/i);
    if (splitMatch.length === 2) {
      const tA = this.normalizeTeamName(splitMatch[0].trim());
      const tB = this.normalizeTeamName(splitMatch[1].trim());
      if (
        tA &&
        tB &&
        tA.toLowerCase() !== tB.toLowerCase() &&
        !this.isGenericTournamentName(tA) &&
        !this.isGenericTournamentName(tB)
      ) {
        return { teamA: tA, teamB: tB };
      }
    }
    return null;
  }

  /**
   * Resolves the best normalized team pair across teamA/teamB, poster params, and eventName.
   * For example, when SportzX sets teamA="76ers", teamB="Raptors" and eventName="Philadelphia 76ers vs Toronto Raptors",
   * this extracts the full franchise names "Philadelphia 76ers" and "Toronto Raptors".
   */
  static extractBestTeams(
    name: string,
    eventInfo?: Record<string, any>,
    posterParams?: { teamA?: string; teamB?: string; title?: string }
  ): { teamA: string; teamB: string } | null {
    const rawTa = eventInfo?.teamA || posterParams?.teamA || "";
    const rawTb = eventInfo?.teamB || posterParams?.teamB || "";
    let ta = rawTa ? this.normalizeTeamName(rawTa) : "";
    let tb = rawTb ? this.normalizeTeamName(rawTb) : "";

    // Check if eventName is actually a full "Team A vs Team B" string (as in SportzX)
    const eventName = eventInfo?.eventName ? repairMojibake(String(eventInfo.eventName)) : "";
    if (eventName && /\s+vs\.?\s+/i.test(eventName) && !eventName.includes(":")) {
      const fromEventName = this.parseTeamsFromTitle(eventName);
      if (fromEventName) {
        if (!ta || fromEventName.teamA.length > ta.length) {
          ta = fromEventName.teamA;
        }
        if (!tb || fromEventName.teamB.length > tb.length) {
          tb = fromEventName.teamB;
        }
      }
    }

    if (
      ta &&
      tb &&
      ta.toLowerCase() !== tb.toLowerCase() &&
      !this.isGenericTournamentName(ta) &&
      !this.isGenericTournamentName(tb)
    ) {
      return { teamA: ta, teamB: tb };
    }

    return this.parseTeamsFromTitle(name);
  }

  /**
   * Helper to slugify team, tournament, or sport strings.
   */
  static slugify(str: string): string {
    return repairMojibake(str || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
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
        jan: "01",
        feb: "02",
        mar: "03",
        apr: "04",
        may: "05",
        jun: "06",
        jul: "07",
        aug: "08",
        sep: "09",
        oct: "10",
        nov: "11",
        dec: "12",
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
      } else if (/\b(?:UTC|GMT)$/i.test(clean)) {
        clean = clean.replace(/\s*(?:UTC|GMT)$/i, "") + " Z";
      } else if (/\bEST$/i.test(clean)) {
        clean = clean.replace(/\s*EST$/i, "") + " -05:00";
      } else if (/\bEDT$/i.test(clean)) {
        clean = clean.replace(/\s*EDT$/i, "") + " -04:00";
      } else if (/\bPST$/i.test(clean)) {
        clean = clean.replace(/\s*PST$/i, "") + " -08:00";
      } else if (/\bCET$/i.test(clean)) {
        clean = clean.replace(/\s*CET$/i, "") + " +01:00";
      } else if (/\bBST$/i.test(clean)) {
        clean = clean.replace(/\s*BST$/i, "") + " +01:00";
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
   * Seamlessly unifies tournament synonyms and match variations without collapsing real 2-team matches.
   */
  static computeCanonicalKey(
    name: string,
    rawSport: string,
    eventInfo?: Record<string, any>,
    posterUrl?: string
  ): string {
    const posterParams = this.extractParamsFromPosterUrl(posterUrl);
    const bestTeams = this.extractBestTeams(name, eventInfo, posterParams);
    const taCandidate = bestTeams?.teamA || "";
    const tbCandidate = bestTeams?.teamB || "";

    const combinedText = `${name} ${eventInfo?.eventName ?? ""} ${eventInfo?.eventType ?? ""} ${taCandidate} ${tbCandidate}`;
    const fullSearchText = `${combinedText} ${posterParams.title ?? ""} ${posterParams.teamA ?? ""} ${posterParams.teamB ?? ""}`;

    // 1. Check Tournament / Show Clusters ONLY when this item is NOT a distinct 2-team match
    if (!bestTeams) {
      for (const cluster of this.TOURNAMENT_CLUSTERS) {
        if (cluster.regex.test(fullSearchText)) {
          return cluster.canonicalKey;
        }
      }
    }

    const sportClassification = this.classifySport(fullSearchText, rawSport);
    const eventDate = eventInfo?.startTime || posterParams.time || "";
    const identity = EventIdentityEngine.parse(fullSearchText, sportClassification.category);
    const disc = identity.canonicalDiscriminator;

    // 2. Check Team Match
    if (bestTeams) {
      // Disambiguate shared pro mascots (e.g. "Kings" in NHL -> "Los Angeles Kings")
      const resolvedA = this.resolveContextualTeamName(bestTeams.teamA, sportClassification.category);
      const resolvedB = this.resolveContextualTeamName(bestTeams.teamB, sportClassification.category);
      return this.generateCanonicalKey(
        sportClassification.category,
        resolvedA,
        resolvedB,
        eventDate,
        disc
      );
    }

    // 3. Fallback to clean tournament or channel slug
    const cleanName = this.cleanTitle(posterParams.title || name);
    return `${sportClassification.category}::${this.slugify(cleanName)}::channel`;
  }

  /**
   * Disambiguates shared mascot names (like "Kings", "Stars", "Panthers", "Jets", "Giants", "Rangers")
   * when the sport category is already known.
   */
  static resolveContextualTeamName(teamName: string, sportCategory: string): string {
    const lower = teamName.toLowerCase().trim();
    if (sportCategory === "hockey") {
      if (lower === "kings") return "Los Angeles Kings";
      if (lower === "stars") return "Dallas Stars";
      if (lower === "panthers") return "Florida Panthers";
      if (lower === "jets") return "Winnipeg Jets";
      if (lower === "rangers") return "New York Rangers";
      if (lower === "hurricanes") return "Carolina Hurricanes";
    } else if (sportCategory === "american_football") {
      if (lower === "giants") return "New York Giants";
      if (lower === "jets") return "New York Jets";
      if (lower === "panthers") return "Carolina Panthers";
      if (lower === "cardinals") return "Arizona Cardinals";
      if (lower === "titans") return "Tennessee Titans";
      if (lower === "lions") return "Detroit Lions";
      if (lower === "eagles") return "Philadelphia Eagles";
    } else if (sportCategory === "basketball") {
      if (lower === "kings") return "Sacramento Kings";
    }
    return teamName;
  }

  /**
   * Checks if a title or team candidate is generic tournament/channel noise rather than a real team or specific tournament.
   */
  static isGenericTournamentName(name: string, teamA?: string, teamB?: string): boolean {
    if (!name) return true;
    const lower = this.cleanTitle(name).toLowerCase().trim();
    if (
      lower === "cricket" ||
      lower === "football" ||
      lower === "basketball" ||
      lower === "hockey" ||
      lower === "ice hockey" ||
      lower === "tennis" ||
      lower === "boxing" ||
      lower === "mixed martial arts" ||
      lower === "mma" ||
      lower === "motorsport" ||
      lower === "golf" ||
      lower === "live events" ||
      lower === "test series" ||
      lower === "one day international" ||
      lower === "live sports" ||
      lower === "team a" ||
      lower === "team b" ||
      lower === "npl" ||
      lower === "wbbl" ||
      lower === "bbl" ||
      lower === "ipl" ||
      lower === "psl" ||
      lower === "abu dhabi" ||
      lower === "t10 league" ||
      lower === "abu dhabi t10" ||
      lower === "nfl" ||
      lower === "redzone" ||
      lower === "nfl redzone" ||
      lower === "atp 250" ||
      lower === "wta" ||
      lower === "stockholm open" ||
      lower === "indian wells" ||
      lower === "one" ||
      lower === "friday fights" ||
      lower === "one friday fights" ||
      lower === "wwe" ||
      lower === "raw" ||
      lower === "smackdown" ||
      lower === "nxt" ||
      lower === "others" ||
      lower === "other" ||
      lower === "tv" ||
      lower === "tennis evento" ||
      lower === "golf eventos"
    ) {
      return true;
    }
    // Any string of the form "Team X vs Team Y" without a tournament prefix (like "UFC 334:") is a match title, not a tournament name!
    if (/\s+vs\.?\s+/i.test(lower) && !lower.includes(":")) {
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
      formats?: Array<{ title?: string; logo?: string | null } | string>;
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
    let isHotExplicit = false;
    let posterTitle = "";
    let candidateEndedCount = 0;
    let totalFormatsCount = 0;
    const broadcastersSet = new Set<string>();
    const detectedLanguages = new Set<string>(["English"]);
    const providerPointers: Record<string, string> = {};
    const providerRawIds: Record<string, string[]> = {};

    for (const c of candidates) {
      if (!providerPointers[c.providerKey]) {
        providerPointers[c.providerKey] = c.rawId;
      }
      if (!providerRawIds[c.providerKey]) {
        providerRawIds[c.providerKey] = [];
      }
      if (!providerRawIds[c.providerKey].includes(c.rawId)) {
        providerRawIds[c.providerKey].push(c.rawId);
      }

      if (c.sport && !rawSport) {
        rawSport = repairMojibake(c.sport);
      }

      if (c.name.includes("🔴") || /\blive\b/i.test(c.name)) {
        isLive = true;
      }

      const posterParams = this.extractParamsFromPosterUrl(c.poster);
      if (c.poster) {
        if (!posterCard) posterCard = c.poster;
        if (posterParams.title && !posterTitle && !this.isGenericTournamentName(posterParams.title)) {
          posterTitle = posterParams.title;
        }
        if (posterParams.teamAImg && !teamALogo) teamALogo = posterParams.teamAImg;
        if (posterParams.teamBImg && !teamBLogo) teamBLogo = posterParams.teamBImg;
        if (posterParams.eventLogo && !tournamentLogo) tournamentLogo = posterParams.eventLogo;
        if (posterParams.time && !startTime) startTime = posterParams.time;
        if (posterParams.isLive) isLive = true;
        if (posterParams.isEnded) candidateEndedCount++;
      }

      // Extract broadcasters and languages from formats
      if (Array.isArray(c.formats)) {
        totalFormatsCount = Math.max(totalFormatsCount, c.formats.length);
        for (const f of c.formats) {
          const t = typeof f === "string" ? f : f?.title;
          if (t && !t.toLowerCase().includes("support") && !t.toLowerCase().includes("goal")) {
            const cleanBroadcaster = repairMojibake(t)
              .replace(/\s*-\s*(AQ|ALT|FHD|HD|SD).*/i, "")
              .trim();
            if (cleanBroadcaster.length > 2) {
              broadcastersSet.add(cleanBroadcaster);
            }
            if (/\b(hindi|hin|star\s*sports\s*1\s*hindi)\b/i.test(t)) detectedLanguages.add("Hindi");
            if (/\b(tamil|tam)\b/i.test(t)) detectedLanguages.add("Tamil");
            if (/\b(telugu|tel)\b/i.test(t)) detectedLanguages.add("Telugu");
            if (/\b(bengali|ben)\b/i.test(t)) detectedLanguages.add("Bengali");
            if (/\b(urdu|urd|tapmad|ptv|tamasha|a\s*sports)\b/i.test(t)) detectedLanguages.add("Urdu");
            if (/\b(spanish|espanol|movistar|espn\s*deportes)\b/i.test(t))
              detectedLanguages.add("Spanish");
          }
        }
      }

      const info = c.eventInfo ?? {};
      if (info.isHot === "1" || info.isHot === 1 || info.isHot === true || info.isPinned === 1) {
        isHotExplicit = true;
      }
      if (info.isLive === "1" || info.isLive === 1 || info.isLive === true) {
        isLive = true;
      }
      if (info.eventBanner && typeof info.eventBanner === "string" && info.eventBanner.startsWith("http") && !bannerWide) {
        bannerWide = info.eventBanner;
      }

      // Extract best normalized teams from candidate as an atomic pair
      // (prevents Home/Away reversal across providers from overwriting teamB with teamA!)
      const bestPair = this.extractBestTeams(c.name, info, posterParams);
      if (
        bestPair &&
        bestPair.teamA.toLowerCase() !== bestPair.teamB.toLowerCase()
      ) {
        if (
          !teamAName ||
          !teamBName ||
          bestPair.teamA.length + bestPair.teamB.length >
            teamAName.length + teamBName.length
        ) {
          teamAName = bestPair.teamA;
          teamBName = bestPair.teamB;
        }
      }

      if (info.teamAFlag && !teamALogo) teamALogo = info.teamAFlag;
      if (info.teamBFlag && !teamBLogo) teamBLogo = info.teamBFlag;

      // Tournament Name: check both eventName AND eventType (since Cricify sets eventName="Cricket" and eventType="ICC World Test Championship")
      // Also check eventCat / c.sport if it specifies a concrete league (e.g. "NBA", "NHL", "NFL", "Copa del Rey", "UEFA Nations", "AFCON", "Asia Cup")
      const tournamentCandidates = [
        info.eventName,
        info.eventType,
        info.eventCat,
        c.sport,
      ]
        .filter((val): val is string => typeof val === "string" && val.trim().length > 0)
        .map((val) => repairMojibake(val.trim()));

      for (const tCand of tournamentCandidates) {
        if (!this.isGenericTournamentName(tCand, teamAName, teamBName)) {
          if (!tournamentName || tCand.length > tournamentName.length) {
            tournamentName = tCand;
          }
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

    if (sportClassification.category === "cricket") {
      detectedLanguages.add("Hindi");
    }

    // Contextualize shared mascot names if this is a match
    if (teamAName && teamBName) {
      teamAName = this.resolveContextualTeamName(teamAName, sportClassification.category);
      teamBName = this.resolveContextualTeamName(teamBName, sportClassification.category);
    }

    // Determine if this is a genuine 2-team Match or a Tournament Channel / Live Show
    let isMatch = false;
    if (
      teamAName &&
      teamBName &&
      teamAName.toLowerCase() !== teamBName.toLowerCase() &&
      !this.isGenericTournamentName(teamAName) &&
      !this.isGenericTournamentName(teamBName) &&
      !canonicalKey.endsWith("::tournament") &&
      !canonicalKey.endsWith("::show") &&
      !canonicalKey.endsWith("::channel")
    ) {
      isMatch = true;
    }

    // Check if canonicalKey matches a canonical tournament/show cluster (for non-matches)
    const cluster = !isMatch
      ? this.TOURNAMENT_CLUSTERS.find(
          (tc) => tc.canonicalKey === canonicalKey || tc.regex.test(sampleText)
        )
      : undefined;

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
      const candidateCleanName = this.cleanTitle(candidates[0]?.name || "");
      if (cluster) {
        title = cluster.displayName;
      } else if (posterTitle) {
        title = posterTitle;
      } else if (candidateCleanName && candidateCleanName.length >= 3) {
        title = candidateCleanName;
      } else if (tournamentName && !this.isGenericTournamentName(tournamentName)) {
        title = tournamentName;
      } else {
        title = `${sportClassification.label} Event`;
      }
      tournamentName = title;
    }

    // Standard ISO Start Time & End Time
    const startTimeIso = this.parseDateTimeIso(startTime);
    const endTimeIso = endTime ? this.parseDateTimeIso(endTime) : undefined;
    const startTimestamp = new Date(startTimeIso).getTime();
    const now = Date.now();

    // Check if match ended
    let isEnded = false;
    if (candidateEndedCount >= candidates.length && startTimestamp < now - 2 * 3600 * 1000) {
      isEnded = true;
    }
    if (endTimeIso) {
      const endTimestamp = new Date(endTimeIso).getTime();
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
      ? this.generateCanonicalKey(
          sportClassification.category,
          teamAName,
          teamBName,
          startTimeIso,
          disc
        )
      : cluster
      ? cluster.canonicalKey
      : canonicalKey;
    const fixtureId = `fix_${this.slugify(finalCanonicalKey)}`;

    // Generate clean 3-letter team codes
    const makeTeamCode = (name: string): string => {
      const base = name.replace(/\s+(?:Women|Under-19|U21|U23)$/i, "").trim();
      const words = base.split(/\s+/).filter(Boolean);
      if (words.length >= 2 && words.length <= 3) {
        const initials = words.map((w) => w[0]).join("").toUpperCase();
        if (initials.length >= 2) return initials.padEnd(3, base.slice(-1).toUpperCase());
      }
      return base.slice(0, 3).toUpperCase();
    };

    // Build Teams Entity ONLY for 2-team matches; null for channels/shows
    const teamsEntity = isMatch
      ? {
          home: {
            id: `team_${this.slugify(teamAName)}`,
            name: teamAName,
            code: makeTeamCode(teamAName),
            logo: teamALogo || posterCard,
          },
          away: {
            id: `team_${this.slugify(teamBName)}`,
            name: teamBName,
            code: makeTeamCode(teamBName),
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

    const providerCount = Object.keys(providerPointers).length;
    const workingFeedsCount = Math.max(broadcastersSet.size, totalFormatsCount, providerCount);

    return {
      fixtureId,
      canonicalKey: finalCanonicalKey,
      sport: sportClassification.label,
      sportCategory: sportClassification.category,
      phase,
      kind,
      isHotMatch: isLive || isHotExplicit || broadcastersSet.size >= 4 || providerCount >= 4,
      title,
      tournament: {
        id: `tourn_${this.slugify(tournamentName)}`,
        name: tournamentName,
        shortName:
          tournamentName.length > 25 ? `${tournamentName.slice(0, 22)}...` : tournamentName,
        stage: identity.stage,
        logo: tournamentLogo || posterCard,
        category: sportClassification.label,
      },
      teams: teamsEntity,
      broadcastInfo,
      schedule: {
        startTimeUtc: startTimeIso,
        endTimeUtc: endTimeIso,
        status: isLive ? "live" : isEnded ? "ended" : "upcoming",
        liveBadgeText: isLive ? "LIVE NOW" : undefined,
        isLive,
      },
      artwork: {
        posterCard: posterCard || tournamentLogo,
        bannerWide: bannerWide || tournamentLogo || posterCard,
      },
      streamMetadata: {
        totalWorkingFeeds: workingFeedsCount,
        availableLanguages: Array.from(detectedLanguages),
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
      providerRawIds,
      providerCount,
    };
  }
}
