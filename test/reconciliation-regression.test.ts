import { describe, it, expect, beforeEach, vi } from "vitest";
import { Aggregator } from "../src/providers/aggregator";
import { UpstreamClient } from "../src/providers/upstream-client";
import { EdgeCache } from "../src/core/cache";
import { Normalizer } from "../src/core/normalizer";
import { EventIdentityEngine } from "../src/core/event-identity";
import { StreamDeduplicator } from "../src/core/deduplicator";
import { ReconciliationEngine } from "../src/core/reconciliation";
import {
  repairMojibake,
  decodeCncRawId,
  validateUpstreamMetasWithAudit,
} from "../src/types/upstream.types";

describe("Automated Reconciliation & Regression Suite", () => {
  beforeEach(() => {
    EdgeCache.clearMemory();
    UpstreamClient.resetCircuitBreakers();
    vi.restoreAllMocks();
  });

  function encodeCncId(provider: string, data: object): string {
    const raw = `${provider}::${JSON.stringify(data)}`;
    const bytes = new TextEncoder().encode(raw);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `cnc:${btoa(binary)}`;
  }

  it("repairs UTF-8 mojibake and properly decodes multi-byte UTF-8 Base64 payloads", () => {
    expect(repairMojibake("TÃ¼rkiye")).toBe("Türkiye");
    expect(repairMojibake("CÃ´te d'Ivoire")).toBe("Côte d'Ivoire");
    expect(repairMojibake("MontrÃ©al Canadiens")).toBe("Montréal Canadiens");
    expect(repairMojibake("FÃºtbol Club Barcelona")).toBe("Fútbol Club Barcelona");
    expect(repairMojibake("CD TarancÃ³n")).toBe("CD Tarancón");

    const encoded = encodeCncId("sportzx", {
      eventId: "utf8_1",
      title: "Türkiye vs Côte d'Ivoire",
      eventInfo: {
        teamA: "Türkiye",
        teamB: "Côte d'Ivoire",
        eventName: "International Friendlies",
        eventType: "Football",
        startTime: "2026-06-10T18:00:00Z",
        endTime: "2026-06-10T20:00:00Z",
      },
    });

    const decoded = decodeCncRawId(encoded);
    expect(decoded.provider).toBe("sportzx");
    expect(decoded.data?.eventInfo?.teamA).toBe("Türkiye");
    expect(decoded.data?.eventInfo?.teamB).toBe("Côte d'Ivoire");
  });

  it("preserves both teams and match kind when providers reverse Home/Away order with asymmetric lengths", () => {
    const candidates = [
      {
        providerKey: "sportzx",
        rawId: "szx_u19",
        name: "AFG-U19 vs IND-U19",
        sport: "Cricket",
        eventInfo: {
          teamA: "AFG-U19",
          teamB: "IND-U19",
          eventName: "Afghanistan Under-19 vs India Under-19",
          eventType: "Cricket",
          startTime: "2026-11-05T08:00:00Z",
          endTime: "2026-11-05T16:00:00Z",
        },
      },
      {
        providerKey: "playztv",
        rawId: "pzt_u19",
        name: "India Under-19 vs Afghanistan Under-19",
        sport: "Cricket",
        eventInfo: {
          teamA: "India Under-19",
          teamB: "Afghanistan Under-19",
          eventName: "Youth ODI Series",
          eventType: "Cricket",
          startTime: "2026-11-05T08:00:00Z",
          endTime: "2026-11-05T16:00:00Z",
        },
      },
    ];

    const fixture = Normalizer.cascadeFixture(
      "cricket::afghanistan-u19::india-u19::u19::odi::2026-11-05::s1",
      candidates
    );
    expect(fixture.kind).toBe("match");
    expect(fixture.teams).toBeDefined();
    expect(fixture.teams?.home.name).not.toBe(fixture.teams?.away.name);
    expect([fixture.teams?.home.name, fixture.teams?.away.name].sort()).toEqual([
      "Afghanistan Under-19",
      "India Under-19",
    ]);
    expect(fixture.title).toContain(" vs ");
    expect(fixture.tournament.name).toBe("Youth ODI Series");
  });

  it("normalizes Women's (-W) and Associate nation codes identically across all providers", () => {
    expect(Normalizer.normalizeTeamName("PAK-W")).toBe("Pakistan Women");
    expect(Normalizer.normalizeTeamName("BAN-W")).toBe("Bangladesh Women");
    expect(Normalizer.normalizeTeamName("NED-W")).toBe("Netherlands Women");
    expect(Normalizer.normalizeTeamName("THA-W")).toBe("Thailand Women");
    expect(Normalizer.normalizeTeamName("AFG-U19")).toBe("Afghanistan Under-19");

    const sportClass = Normalizer.classifySport("NED-W vs THA-W", "T20I");
    expect(sportClass.category).toBe("cricket");
  });

  it("normalizes NBA, NHL, NFL franchise mascots and European football clubs without false sport classification", () => {
    expect(Normalizer.normalizeTeamName("76ers")).toBe("Philadelphia 76ers");
    expect(Normalizer.normalizeTeamName("Raptors")).toBe("Toronto Raptors");
    expect(Normalizer.normalizeTeamName("Kraken")).toBe("Seattle Kraken");
    expect(Normalizer.normalizeTeamName("Commanders")).toBe("Washington Commanders");
    expect(Normalizer.normalizeTeamName("VfL Wolfsburg")).toBe("Wolfsburg");
    expect(Normalizer.normalizeTeamName("1. FC Union Berlin")).toBe("Union Berlin");
    expect(Normalizer.normalizeTeamName("Fútbol Club Barcelona")).toBe("Barcelona");

    // Ensure NHL Kings vs Islanders is classified as hockey, not basketball
    expect(
      Normalizer.classifySport("Los Angeles Kings vs New York Islanders", "NHL").category
    ).toBe("hockey");
    // Ensure WBBL Sixers vs Renegades is classified as cricket, not basketball
    expect(
      Normalizer.classifySport(
        "Melbourne Renegades Women vs Sydney Sixers Women",
        "WBBL"
      ).category
    ).toBe("cricket");
    // Ensure SportzX tournament names map to football
    expect(Normalizer.classifySport("Nigeria vs Ivory Coast", "AFCON").category).toBe("football");
    expect(Normalizer.classifySport("Spain vs France", "UEFA Nations").category).toBe("football");
  });

  it("preserves real competition names (One Day International, NFL, Stockholm Open, Copa del Rey) while rejecting them as fake team names", () => {
    expect(Normalizer.normalizeTournamentName("Copa Del Rey 🇪🇸")).toBe("Copa del Rey");
    expect(Normalizer.normalizeTournamentName("NFL | NFL REDZONE")).toBe("NFL RedZone");
    expect(Normalizer.normalizeTournamentName("Womens Emerging Nations Trophy")).toBe(
      "Women's Emerging Nations Trophy"
    );

    const odiFixture = Normalizer.cascadeFixture("cricket::india::new-zealand::odi::2026-11-12::s1", [
      {
        providerKey: "cricify",
        rawId: "crc_nz_ind",
        name: "New Zealand vs India",
        sport: "Cricket",
        eventInfo: {
          teamA: "New Zealand",
          teamB: "India",
          eventName: "One Day International",
          eventCat: "Cricket",
          startTime: "2026-11-12T08:00:00Z",
          endTime: "2026-11-12T16:00:00Z",
        },
      },
    ]);
    expect(odiFixture.tournament.name).toBe("One Day International");

    const nflFixture = Normalizer.cascadeFixture(
      "american_football::new-york-giants::washington-commanders::2026-11-12::s3",
      [
        {
          providerKey: "sportzx",
          rawId: "szx_nfl_1",
          name: "New York Giants vs Washington Commanders",
          sport: "American Football",
          eventInfo: {
            teamA: "New York Giants",
            teamB: "Washington Commanders",
            eventName: "NFL",
            eventCat: "American Football",
            startTime: "2026-11-12T18:00:00Z",
            endTime: "2026-11-12T21:30:00Z",
          },
        },
      ]
    );
    expect(nflFixture.sportCategory).toBe("american_football");
    expect(nflFixture.tournament.name).toBe("NFL");

    const tennisShow = Normalizer.cascadeFixture("tennis::stockholm-open::show", [
      {
        providerKey: "playztv",
        rawId: "pzt_atp",
        name: "ATP",
        sport: "Tennis",
        eventInfo: {
          teamA: "ATP",
          teamB: "Stockholm Open",
          eventName: "Stockholm Open",
          eventCat: "Tennis",
          startTime: "2026-11-12T12:00:00Z",
          endTime: "2026-11-12T18:00:00Z",
        },
      },
    ]);
    expect(tennisShow.kind).not.toBe("match");
    expect(tennisShow.title).toBe("Stockholm Open");
  });

  it("audits invalid upstream catalog entries with traceable exclusion reasons and zero silent drops", () => {
    const nonArrayAudit = validateUpstreamMetasWithAudit({ broken: true }, "sportzx");
    expect(nonArrayAudit.valid).toHaveLength(0);
    expect(nonArrayAudit.exclusions).toHaveLength(1);
    expect(nonArrayAudit.exclusions[0].reason).toBe("INVALID_ARRAY");

    const mixedAudit = validateUpstreamMetasWithAudit(
      [
        { id: "cnc:valid_1", name: "Arsenal vs Chelsea", type: "tv" },
        null,
        { id: "   ", name: "Missing ID Item" },
      ],
      "playztv"
    );
    expect(mixedAudit.valid).toHaveLength(1);
    expect(mixedAudit.exclusions).toHaveLength(2);
    expect(mixedAudit.exclusions.map((e) => e.reason)).toEqual(["NON_OBJECT", "MISSING_ID"]);
  });

  it("extracts regional stream languages from bare codes and URL paths, strips ephemeral auth tokens, and sorts HD primary feeds before low-res fallbacks", () => {
    const rawStreams = [
      {
        providerKey: "sportzx",
        name: "Willow Cricket",
        title: "Willow HD - 396p (Lowest Quality)",
        url: "https://cdn.example.com/willow/master.m3u8?maxh=396&hdnea=exp=1700000001~hmac=abc111",
      },
      {
        providerKey: "playztv",
        name: "Willow Cricket",
        title: "Willow HD - 396p Mirror",
        url: "https://cdn.example.com/willow/master.m3u8?maxh=396&hdnea=exp=1700009999~hmac=xyz999",
      },
      {
        providerKey: "cricify",
        name: "Willow Cricket",
        title: "Willow Full HD - 1080p",
        url: "https://cdn.example.com/willow/master.m3u8?maxh=1080&hdnea=exp=1700000001~hmac=def222",
      },
      {
        providerKey: "sportzx",
        name: "Sony LIV",
        title: "SONYLIV KAN - AQ",
        url: "https://dai.google.com/linear/hls/event/cricodi_1211/KAN/master.m3u8",
      },
      {
        providerKey: "livxow",
        name: "Sony LIV",
        title: "SONYLIV TEL - AQ",
        url: "https://dai.google.com/linear/hls/event/cricodi_1211/TEL/master.m3u8",
      },
    ];

    const report = StreamDeduplicator.deduplicateWithAudit(rawStreams);
    expect(report.audit.exclusions).toHaveLength(0);
    // The two 396p streams with different hdnea tokens collapse into 1 feed with 1 mirror, while 1080p remains distinct
    expect(report.streams).toHaveLength(4);

    // 1080p primary feed is sorted ahead of the 396p stream even though 396p was first in raw input
    expect(report.streams[0].qualityVariant).toBe("1080p");
    expect(report.streams[0].priorityTier).toBe("primary");

    const languages = report.streams.map((s) => s.language.code);
    expect(languages).toContain("kan");
    expect(languages).toContain("tel");

    const mirrorGroups = StreamDeduplicator.buildMirrorGroups(report.streams);
    expect(mirrorGroups.length).toBeGreaterThanOrEqual(3);
    const willowGroup = mirrorGroups.find((g) => g.channelGroup === "Willow");
    expect(willowGroup).toBeDefined();
    expect(willowGroup?.qualities).toContain("1080p");
    expect(willowGroup?.qualities).toContain("396p");
  });

  it("reconciles cross-provider fixtures with explainable confidence scores and prevented merge tracking", async () => {
    vi.spyOn(UpstreamClient, "fetchCatalog").mockImplementation(async (catalogId: string) => {
      if (catalogId === "cnc_SportzXLiveEvents_tv") {
        // Provider 1 (SportzX): omits "Test" in eventName, has 05:00Z (slot s0)
        return [
          {
            id: encodeCncId("sportzx", {
              eventId: "szx_pak_sl",
              title: "PAK vs SL",
              eventInfo: {
                teamA: "PAK",
                teamB: "SL",
                eventName: "Pakistan vs Sri Lanka",
                eventCat: "Cricket",
                startTime: "2026-11-12T05:00:00Z",
                endTime: "2026-11-12T13:00:00Z",
              },
            }),
            type: "tv",
            name: "PAK vs SL",
          },
        ];
      }
      if (catalogId === "cnc_CricifyLiveEvents_tv") {
        // Provider 2 (Cricify): has "ICC World Test Championship" in eventType, 06:00Z (slot s1)
        return [
          {
            id: encodeCncId("cricify", {
              eventId: "crc_pak_sl",
              title: "Pakistan vs Sri Lanka",
              eventInfo: {
                teamA: "Pakistan",
                teamB: "Sri Lanka",
                eventName: "Cricket",
                eventType: "ICC World Test Championship",
                eventCat: "Cricket",
                startTime: "2026-11-12T06:00:00Z",
                endTime: "2026-11-12T14:00:00Z",
              },
            }),
            type: "tv",
            name: "Pakistan vs Sri Lanka",
          },
        ];
      }
      if (catalogId === "cnc_PlayZTVLiveEvents_tv") {
        // Distinct Match (2nd Test on a different date - MUST NOT MERGE)
        return [
          {
            id: encodeCncId("playztv", {
              eventId: "pzt_pak_sl_2",
              title: "Pakistan vs Sri Lanka - 2nd Test",
              eventInfo: {
                teamA: "Pakistan",
                teamB: "Sri Lanka",
                eventName: "ICC World Test Championship - 2nd Test",
                eventCat: "Cricket",
                startTime: "2026-11-20T05:00:00Z",
                endTime: "2026-11-20T13:00:00Z",
              },
            }),
            type: "tv",
            name: "Pakistan vs Sri Lanka - 2nd Test",
          },
        ];
      }
      return [];
    });

    const catalog = await Aggregator.getUnifiedCatalog(undefined, "all");
    expect(catalog.reconciliation?.unmappedRawItemsCount).toBe(0);
    expect(catalog.reconciliation?.totalRawItemsExtracted).toBe(3);
    expect(catalog.fixtures).toHaveLength(2);

    const nov12Fixture = catalog.fixtures.find((f) =>
      f.schedule.startTimeUtc.startsWith("2026-11-12")
    );
    expect(nov12Fixture).toBeDefined();
    expect(nov12Fixture?.providerCount).toBe(2);
    expect(nov12Fixture?.tournament.name).toBe("ICC World Test Championship");
    expect(nov12Fixture?.mergeConfidence).toBeGreaterThanOrEqual(0.8);
    expect(nov12Fixture?.mergeSignals).toContain("normalized_team_pair");

    const reconReport = await Aggregator.getReconciliationReport();
    expect(reconReport).not.toBeNull();
    expect(reconReport?.status).toBe("verified_zero_loss");
    expect(reconReport?.summary.unmappedRawItemsCount).toBe(0);
    expect(reconReport?.preventedMerges.length).toBeGreaterThanOrEqual(1);
    expect(reconReport?.preventedMerges[0].reason).toBe("EXCEEDED_TIME_WINDOW");
  });

  it("never merges distinct match numbers (1st T20I vs 2nd T20I) even on the same day", () => {
    const id1 = EventIdentityEngine.parse(
      "India vs Australia 1st T20I T20I Series",
      "cricket"
    );
    const id2 = EventIdentityEngine.parse(
      "India vs Australia 2nd T20I T20I Series",
      "cricket"
    );

    expect(id1.canonicalDiscriminator).not.toBe(id2.canonicalDiscriminator);
    expect(EventIdentityEngine.areCompatible(id1, id2)).toBe(false);
  });
});

