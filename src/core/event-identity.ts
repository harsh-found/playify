/**
 * Multi-dimensional sport event identity parser for Playify Edge.
 * Extracts format, match number, tournament stage, gender, and age categories
 * to ensure zero false collisions between same-team series/tour fixtures.
 */

export interface EventIdentity {
  format?: string;
  matchNumber?: string;
  stage?: string;
  gender?: "men" | "women";
  ageGroup?: string;
  seriesOrTour?: string;
  canonicalDiscriminator: string;
}

export class EventIdentityEngine {
  // Cricket Formats
  private static CRICKET_FORMAT_RULES: Array<{ format: string; regex: RegExp }> = [
    { format: "t10", regex: /\b(?:t10|ten\s*10|10\s*overs?)\b/i },
    { format: "the_hundred", regex: /\b(?:the\s*hundred|100\s*balls?)\b/i },
    { format: "t20", regex: /\b(?:t20i?|twenty\s*20|20\s*overs?|ipl|psl|bbl|wbbl|cpl|npl|bpl|smat)\b/i },
    { format: "odi", regex: /\b(?:odi|one\s*day(?:\s*international)?|50\s*overs?)\b/i },
    { format: "test", regex: /\b(?:test(?:\s*match|\s*series)?|ashes|ranji|sheffield\s*shield|first\s*class)\b/i },
  ];

  // Motorsport Sessions
  private static MOTORSPORT_SESSION_RULES: Array<{ format: string; regex: RegExp }> = [
    { format: "fp1", regex: /\b(?:fp1|free\s*practice\s*1|practice\s*1)\b/i },
    { format: "fp2", regex: /\b(?:fp2|free\s*practice\s*2|practice\s*2)\b/i },
    { format: "fp3", regex: /\b(?:fp3|free\s*practice\s*3|practice\s*3)\b/i },
    { format: "sprint_shootout", regex: /\b(?:sprint\s*shootout|sprint\s*qualifying)\b/i },
    { format: "sprint", regex: /\b(?:sprint(?:\s*race)?)\b/i },
    { format: "qualifying", regex: /\b(?:qualifying|q1|q2|q3|pole\s*position)\b/i },
    { format: "race", regex: /\b(?:grand\s*prix|main\s*race|race\s*day)\b/i },
  ];

  // Match Numbers (1st, 2nd, 3rd, Match 14, Game 3)
  private static MATCH_NUMBER_RULES: Array<{ num: string; regex: RegExp }> = [
    { num: "m1", regex: /\b(?:1st|first|\b1\b(?=\s*(?:test|odi|t20|t10|leg|match|game)))\b/i },
    { num: "m2", regex: /\b(?:2nd|second|\b2\b(?=\s*(?:test|odi|t20|t10|leg|match|game)))\b/i },
    { num: "m3", regex: /\b(?:3rd|third|\b3\b(?=\s*(?:test|odi|t20|t10|leg|match|game)))\b/i },
    { num: "m4", regex: /\b(?:4th|fourth|\b4\b(?=\s*(?:test|odi|t20|t10|leg|match|game)))\b/i },
    { num: "m5", regex: /\b(?:5th|fifth|\b5\b(?=\s*(?:test|odi|t20|t10|leg|match|game)))\b/i },
  ];

  // Tournament Stages (compound stages ordered before standalone final)
  private static STAGE_RULES: Array<{ stage: string; regex: RegExp }> = [
    { stage: "semi_final", regex: /\b(?:semi\s*finals?|semi-finals?|semifinals?|sf\s*[12])\b/i },
    { stage: "quarter_final", regex: /\b(?:quarter\s*finals?|quarter-finals?|quarterfinals?|qf\s*[1-4])\b/i },
    { stage: "qualifier", regex: /\b(?:qualifier\s*[12]|preliminary)\b/i },
    { stage: "eliminator", regex: /\b(?:eliminator(?:\s*[12])?)\b/i },
    { stage: "third_place", regex: /\b(?:3rd\s*place|third\s*place|bronze\s*match)\b/i },
    { stage: "final", regex: /(?<!semi\s*|quarter\s*|semi-|quarter-)\b(?:the\s*final|grand\s*final|\bfinal\b)(?!\s*(?:four|eight))\b/i },
    { stage: "playoff", regex: /\b(?:playoffs?|play-offs?)\b/i },
    { stage: "group_stage", regex: /\b(?:group\s*stage|round\s*of\s*16|round\s*of\s*32)\b/i },
  ];

  /**
   * Parses full event title and metadata to extract structural attributes.
   */
  static parse(text: string, sportCategory?: string): EventIdentity {
    const clean = text.toLowerCase();

    // 1. Gender Detection
    let gender: "men" | "women" | undefined;
    if (/\b(?:women|women's|womens|\bwbbl\b|\bwpl\b|ucl\s*womens?)\b/i.test(clean)) {
      gender = "women";
    } else if (/\b(?:men|men's|mens)\b/i.test(clean)) {
      gender = "men";
    }

    // 2. Age Group Detection
    let ageGroup: string | undefined;
    if (/\b(?:under\s*19|under-19|u\s*19|u-19)\b/i.test(clean)) {
      ageGroup = "u19";
    } else if (/\b(?:under\s*21|under-21|u\s*21|u-21)\b/i.test(clean)) {
      ageGroup = "u21";
    } else if (/\b(?:under\s*23|under-23|u\s*23|u-23)\b/i.test(clean)) {
      ageGroup = "u23";
    }

    // 3. Format Detection
    let format: string | undefined;
    const isMotorsport = sportCategory === "motorsport" || /\b(f1|formula\s*1|motogp)\b/i.test(clean);
    const isCricket = sportCategory === "cricket" || /\b(cricket|t20|odi|test|ipl|bbl|psl)\b/i.test(clean);

    if (isMotorsport) {
      for (const rule of this.MOTORSPORT_SESSION_RULES) {
        if (rule.regex.test(clean)) {
          format = rule.format;
          break;
        }
      }
    } else if (isCricket) {
      for (const rule of this.CRICKET_FORMAT_RULES) {
        if (rule.regex.test(clean)) {
          format = rule.format;
          break;
        }
      }
    }

    // 4. Tournament Stage Detection
    let stage: string | undefined;
    for (const rule of this.STAGE_RULES) {
      if (rule.regex.test(clean)) {
        stage = rule.stage;
        break;
      }
    }

    // 5. Match Number Detection
    let matchNumber: string | undefined;
    const explicitMatch = clean.match(/\b(?:match|game|leg)\s*#?\s*(\d{1,3})\b/i);
    if (explicitMatch) {
      matchNumber = `m${explicitMatch[1]}`;
    } else {
      for (const rule of this.MATCH_NUMBER_RULES) {
        if (rule.regex.test(clean)) {
          matchNumber = rule.num;
          break;
        }
      }
    }

    // Build deterministic canonical discriminator
    const parts: string[] = [];
    if (gender === "women") parts.push("w");
    if (ageGroup) parts.push(ageGroup);
    if (format) parts.push(format);
    if (stage) parts.push(stage);
    if (matchNumber && !stage) parts.push(matchNumber);

    const canonicalDiscriminator = parts.join("::");

    return {
      format,
      matchNumber,
      stage,
      gender,
      ageGroup,
      canonicalDiscriminator,
    };
  }
}
