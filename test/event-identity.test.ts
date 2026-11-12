import { describe, it, expect } from "vitest";
import { EventIdentityEngine } from "../src/core/event-identity";

describe("EventIdentityEngine", () => {
  it("extracts cricket format and match numbers correctly", () => {
    const id1 = EventIdentityEngine.parse("India vs England - 1st Test Match", "cricket");
    expect(id1.format).toBe("test");
    expect(id1.matchNumber).toBe("m1");
    expect(id1.canonicalDiscriminator).toBe("test::m1");

    const id2 = EventIdentityEngine.parse("India vs England - 2nd Test", "cricket");
    expect(id2.format).toBe("test");
    expect(id2.matchNumber).toBe("m2");
    expect(id2.canonicalDiscriminator).toBe("test::m2");

    // Proves 1st Test and 2nd Test produce different discriminators
    expect(id1.canonicalDiscriminator).not.toBe(id2.canonicalDiscriminator);
  });

  it("differentiates Test vs T20I vs ODI between identical teams", () => {
    const testMatch = EventIdentityEngine.parse("Australia vs Pakistan 1st Test", "cricket");
    const t20Match = EventIdentityEngine.parse("Australia vs Pakistan 1st T20I", "cricket");
    const odiMatch = EventIdentityEngine.parse("Australia vs Pakistan 1st ODI", "cricket");

    expect(testMatch.format).toBe("test");
    expect(t20Match.format).toBe("t20");
    expect(odiMatch.format).toBe("odi");

    expect(testMatch.canonicalDiscriminator).toBe("test::m1");
    expect(t20Match.canonicalDiscriminator).toBe("t20::m1");
    expect(odiMatch.canonicalDiscriminator).toBe("odi::m1");
  });

  it("isolates tournament stages accurately", () => {
    const semiFinal = EventIdentityEngine.parse("Real Madrid vs Bayern Munich Semi-Final", "football");
    const finalMatch = EventIdentityEngine.parse("Real Madrid vs Borussia Dortmund The Final", "football");

    expect(semiFinal.stage).toBe("semi_final");
    expect(finalMatch.stage).toBe("final");
    expect(semiFinal.canonicalDiscriminator).toBe("semi_final");
    expect(finalMatch.canonicalDiscriminator).toBe("final");
  });

  it("detects women categories and prevents WBBL vs BBL collisions", () => {
    const wbbl = EventIdentityEngine.parse("Sydney Sixers vs Melbourne Stars WBBL", "cricket");
    const bbl = EventIdentityEngine.parse("Sydney Sixers vs Melbourne Stars BBL", "cricket");

    expect(wbbl.gender).toBe("women");
    expect(bbl.gender).toBeUndefined();
    expect(wbbl.canonicalDiscriminator).toContain("w::t20");
    expect(bbl.canonicalDiscriminator).toBe("t20");
  });

  it("handles Under-19 categories", () => {
    const u19 = EventIdentityEngine.parse("India Under-19 vs Australia Under-19 Final", "cricket");
    expect(u19.ageGroup).toBe("u19");
    expect(u19.stage).toBe("final");
    expect(u19.canonicalDiscriminator).toContain("u19");
    expect(u19.canonicalDiscriminator).toContain("final");
  });

  it("identifies motorsport sessions (FP1 vs Qualifying vs Race)", () => {
    const fp1 = EventIdentityEngine.parse("F1 Abu Dhabi Grand Prix Free Practice 1", "motorsport");
    const qualy = EventIdentityEngine.parse("F1 Abu Dhabi Grand Prix Qualifying", "motorsport");
    const race = EventIdentityEngine.parse("F1 Abu Dhabi Grand Prix Race", "motorsport");

    expect(fp1.format).toBe("fp1");
    expect(qualy.format).toBe("qualifying");
    expect(race.format).toBe("race");

    expect(fp1.canonicalDiscriminator).toBe("fp1");
    expect(qualy.canonicalDiscriminator).toBe("qualifying");
    expect(race.canonicalDiscriminator).toBe("race");
  });

  it("normalizes word variants: 'First T20' matches '1st T20I'", () => {
    const v1 = EventIdentityEngine.parse("IND vs ENG First T20", "cricket");
    const v2 = EventIdentityEngine.parse("India vs England 1st T20I", "cricket");

    expect(v1.canonicalDiscriminator).toBe(v2.canonicalDiscriminator);
    expect(v1.canonicalDiscriminator).toBe("t20::m1");
  });
});
