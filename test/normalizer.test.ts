import { describe, it, expect } from "vitest";
import { Normalizer } from "../src/core/normalizer";

describe("Normalizer Unit Tests", () => {
  it("normalizes team aliases correctly", () => {
    expect(Normalizer.normalizeTeamName("IND")).toBe("India");
    expect(Normalizer.normalizeTeamName("NZ")).toBe("New Zealand");
    expect(Normalizer.normalizeTeamName("PAK")).toBe("Pakistan");
    expect(Normalizer.normalizeTeamName("SL")).toBe("Sri Lanka");
    expect(Normalizer.normalizeTeamName("BAN")).toBe("Bangladesh");
    expect(Normalizer.normalizeTeamName("WI")).toBe("West Indies");
    expect(Normalizer.normalizeTeamName("AFG")).toBe("Afghanistan");
    expect(Normalizer.normalizeTeamName("ZIM")).toBe("Zimbabwe");
  });

  it("produces identical canonical key regardless of team order (symmetry test)", () => {
    const key1 = Normalizer.generateCanonicalKey("cricket", "IND", "NZ", "2026-11-10T02:00:00Z");
    const key2 = Normalizer.generateCanonicalKey("cricket", "New Zealand", "India", "2026-11-10T02:00:00Z");
    const key3 = Normalizer.generateCanonicalKey("cricket", "NZ", "IND", "2026/11/10 02:00:00 +0000");

    expect(key1).toBe("cricket::india::new-zealand::2026-11-10::s0");
    expect(key2).toBe("cricket::india::new-zealand::2026-11-10::s0");
    expect(key3).toBe("cricket::india::new-zealand::2026-11-10::s0");
    expect(key1).toBe(key2);
    expect(key2).toBe(key3);
  });

  it("strips status emojis and noise from titles", () => {
    expect(Normalizer.cleanTitle("🔴 IND vs NZ")).toBe("IND vs NZ");
    expect(Normalizer.cleanTitle("🔜 Pakistan vs Sri Lanka")).toBe("Pakistan vs Sri Lanka");
    expect(Normalizer.cleanTitle("✅ BAN vs WI")).toBe("BAN vs WI");
    expect(Normalizer.cleanTitle("🎬 Willow HD • CNCVerse Bridge")).toBe("Willow HD");
  });

  it("cascades metadata and picks richest tournament name and logos for matches", () => {
    const canonicalKey = "cricket::pakistan::sri-lanka::2026-11-10";

    const candidateFromSportzX = {
      providerKey: "sportzx",
      rawId: "id-sportzx-1",
      name: "🔜 PAK vs SL",
      sport: "Cricket",
      eventInfo: {
        teamA: "PAK",
        teamB: "SL",
        eventName: "Cricket", // Generic name
        startTime: "2026/11/10 04:30:00 +0000",
      },
    };

    const candidateFromPlayZTV = {
      providerKey: "playztv",
      rawId: "id-playztv-1",
      name: "🔴 Pakistan vs Sri Lanka",
      sport: "Cricket",
      eventInfo: {
        teamA: "Pakistan",
        teamB: "Sri Lanka",
        eventName: "ICC World Test Championship", // Rich tournament name!
        eventLogo: "https://img.sofascore.com/api/v1/unique-tournament/18833/image/dark",
        teamAFlag: "https://img.sofascore.com/api/v1/team/187754/image",
        teamBFlag: "https://img.sofascore.com/api/v1/team/187756/image",
      },
      formats: [
        { title: "WILLOW - FHD" },
        { title: "TAPMAD - AQ" },
        { title: "PTV SPORTS HD" },
      ],
    };

    const fixture = Normalizer.cascadeFixture(canonicalKey, [
      candidateFromSportzX,
      candidateFromPlayZTV,
    ]);

    expect(fixture.kind).toBe("match");
    expect(fixture.teams).not.toBeNull();
    expect(fixture.teams?.home.name).toBe("Pakistan");
    expect(fixture.teams?.away.name).toBe("Sri Lanka");
    expect(fixture.title).toBe("Pakistan vs Sri Lanka");
    expect(fixture.tournament.name).toBe("ICC World Test Championship");
    expect(fixture.tournament.logo).toBe(
      "https://img.sofascore.com/api/v1/unique-tournament/18833/image/dark"
    );
    expect(fixture.phase).toBe("live");
    expect(fixture.streamMetadata.primaryBroadcasters).toContain("WILLOW");
    expect(fixture.streamMetadata.primaryBroadcasters).toContain("TAPMAD");
  });

  describe("Smart Sport Classifier & Upstream Fixes", () => {
    it("overrides upstream 'Cricket' category for Formula 1 and MotoGP", () => {
      const f1 = Normalizer.classifySport("Formula 1 Abu Dhabi GP Practice 1", "Cricket");
      expect(f1.category).toBe("motorsport");
      expect(f1.label).toBe("Motorsport");
      expect(f1.icon).toBe("🏎️");

      const motoGp = Normalizer.classifySport("MotoGP Grand Prix of Valencia", "Cricket");
      expect(motoGp.category).toBe("motorsport");
      expect(motoGp.label).toBe("Motorsport");
    });

    it("overrides upstream category for WWE and Combat sports", () => {
      const wwe = Normalizer.classifySport("WWE Monday Night RAW Live", "Cricket");
      expect(wwe.category).toBe("combat");
      expect(wwe.label).toBe("Combat Sports");
      expect(wwe.icon).toBe("🥊");

      const smackdown = Normalizer.classifySport("Friday Night SmackDown", "tv");
      expect(smackdown.category).toBe("combat");

      const oneFight = Normalizer.classifySport("ONE Fighting Championship", "Cricket");
      expect(oneFight.category).toBe("combat");

      const fridayFights = Normalizer.classifySport("🔜 Friday Fights", "Boxing");
      expect(fridayFights.category).toBe("combat");
    });

    it("identifies Football, Tennis, Basketball, Hockey, and NFL accurately", () => {
      expect(Normalizer.classifySport("UEFA Champions League Arsenal vs Bayern", "tv").category).toBe("football");
      expect(Normalizer.classifySport("Wimbledon Mens Final", "other").category).toBe("tennis");
      expect(Normalizer.classifySport("NBA Lakers vs Warriors", "tv").category).toBe("basketball");
      expect(Normalizer.classifySport("🔜 Hawks vs Lakers", "Cricket").category).toBe("basketball");
      expect(Normalizer.classifySport("🔜 Oilers vs Rangers", "NHL").category).toBe("hockey");
      expect(Normalizer.classifySport("✅ NFL vs REDZONE", "").category).toBe("american_football");
      expect(Normalizer.classifySport("🔜 Sabadell vs Real Sociedad B", "Cricket").category).toBe("football");
    });

    it("classifies Rugby, Table Tennis, Volleyball, Golf, Athletics accurately", () => {
      expect(Normalizer.classifySport("Six Nations England vs France", "").category).toBe("rugby");
      expect(Normalizer.classifySport("WTT Champions Table Tennis Final", "").category).toBe("table_tennis");
      expect(Normalizer.classifySport("FIVB Volleyball Nations League", "").category).toBe("volleyball");
      expect(Normalizer.classifySport("PGA Tour The Masters Round 2", "").category).toBe("golf");
      expect(Normalizer.classifySport("World Athletics Championships 100m", "").category).toBe("athletics");
    });

    it("does NOT merge matches between same teams on consecutive days if >8 hours apart", () => {
      const day1 = "2026-11-10T04:30:00Z";
      const day2 = "2026-11-11T04:30:00Z";
      const k1 = Normalizer.generateCanonicalKey("cricket", "India", "Australia", day1);
      const k2 = Normalizer.generateCanonicalKey("cricket", "India", "Australia", day2);
      expect(k1).not.toBe(k2);
      expect(k1).toContain("2026-11-10");
      expect(k2).toContain("2026-11-11");
    });

    it("disambiguates same-day double-headers occurring >6 hours apart", () => {
      const match1 = "2026-11-10T10:00:00Z";
      const match2 = "2026-11-10T19:00:00Z";
      const k1 = Normalizer.generateCanonicalKey("basketball", "Lakers", "Warriors", match1);
      const k2 = Normalizer.generateCanonicalKey("basketball", "Lakers", "Warriors", match2);
      expect(k1).not.toBe(k2);
    });
  });

  describe("Tournament Synonyms Clustering & Channel Detection", () => {
    it("clusters Abu Dhabi T10 across variations into one canonical key", () => {
      const k1 = Normalizer.computeCanonicalKey("🔜 Abu Dhabi vs T10 League", "Cricket");
      const k2 = Normalizer.computeCanonicalKey("🔴 Abu Dhabi T10", "Cricket");
      const k3 = Normalizer.computeCanonicalKey("🔴 T10 LEAGUE", "Cricket");

      expect(k1).toBe("cricket::abu-dhabi-t10::tournament");
      expect(k2).toBe("cricket::abu-dhabi-t10::tournament");
      expect(k3).toBe("cricket::abu-dhabi-t10::tournament");
      expect(k1).toBe(k2);
      expect(k2).toBe(k3);
    });

    it("clusters Nepal Premier League (NPL) and eliminates 'Team A vs Team B'", () => {
      const canonicalKey = Normalizer.computeCanonicalKey(
        "✅ NPL",
        "Cricket",
        { teamA: "NPL" },
        "https://card.cncverse.dpdns.org/?title=Nepal+Premier+League&teamA=NPL&time=Nov+09%2C+2026"
      );

      expect(canonicalKey).toBe("cricket::nepal-premier-league::tournament");

      const candidates = [
        {
          providerKey: "sportzx",
          rawId: "cnc_SportzX_npl",
          name: "✅ NPL",
          sport: "Cricket",
          eventInfo: { teamA: "NPL" },
          poster: "https://card.cncverse.dpdns.org/?title=Nepal+Premier+League&teamA=NPL",
        },
        {
          providerKey: "sktech",
          rawId: "cnc_SKTech_npl",
          name: "🔴 Nepal Premier League",
          sport: "Cricket",
          poster: "https://card.cncverse.dpdns.org/?title=Nepal+Premier+league+&teamA=NPL",
        },
      ];

      const fixture = Normalizer.cascadeFixture(canonicalKey, candidates);

      // Must be a tournament channel with teams: null, NOT "Team A vs Team B"!
      expect(fixture.kind).toBe("tournament_channel");
      expect(fixture.teams).toBeNull();
      expect(fixture.title).toBe("Nepal Premier League (NPL)");
      expect(fixture.title).not.toContain("Team A");
      expect(fixture.title).not.toContain("Team B");
      expect(fixture.broadcastInfo?.badgeText).toBe("LEAGUE CHANNEL");
      expect(fixture.providerPointers["sportzx"]).toBe("cnc_SportzX_npl");
      expect(fixture.providerPointers["sktech"]).toBe("cnc_SKTech_npl");
    });

    it("collapses self-referential 'X vs X' titles (e.g. GOLF EVENTOS vs GOLF EVENTOS) and classifies NBL as Basketball", () => {
      expect(Normalizer.cleanTitle("🔴 GOLF EVENTOS vs GOLF EVENTOS")).toBe("GOLF EVENTOS");

      const golfKey1 = Normalizer.computeCanonicalKey(
        "🔴 Golf Eventos",
        "Golf",
        { eventName: "GOLF EVENTOS vs GOLF EVENTOS" },
        "https://card.cncverse.dpdns.org/?title=GOLF+EVENTOS+vs+GOLF+EVENTOS"
      );
      const golfKey2 = Normalizer.computeCanonicalKey(
        "🔴 Golf Eventos",
        "Golf",
        { eventName: "Golf Eventos" }
      );
      expect(golfKey1).toBe("golf::golf-eventos::channel");
      expect(golfKey2).toBe("golf::golf-eventos::channel");

      const nbl = Normalizer.classifySport("Perth Wildcats vs Tasmania Jackjumpers", "NBL");
      expect(nbl.category).toBe("basketball");

      const uclWomensKey = Normalizer.computeCanonicalKey(
        "FC Barcelona vs Arsenal",
        "UCL Womens",
        {
          teamA: "Barcelona",
          teamB: "Arsenal",
          startTime: "2026-11-12T17:45:00Z",
        }
      );
      expect(uclWomensKey).toBe("football::arsenal::barcelona::w::2026-11-12::s2");
      expect(Normalizer.normalizeTournamentName("U19 Asia Cup Final")).toBe("U19 Asia Cup");
      expect(Normalizer.normalizeTournamentName("UCL Womens")).toBe(
        "UEFA Women's Champions League"
      );
    });
  });
});

