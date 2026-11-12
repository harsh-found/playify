import { UnifiedFixture } from "../types/catalog.types";
import { CatalogExclusion } from "../types/upstream.types";

/**
 * Explainable Entity-Resolution & Source-to-Output Reconciliation Engine.
 * Tracks every raw upstream record from extraction to final UnifiedFixture output,
 * proves zero accidental data loss, and records confidence scores for every cross-provider merge.
 */

export type MergeResolutionType =
  | "exact_canonical_key"
  | "nodate_reconciliation"
  | "cross_format_reconciliation"
  | "near_time_reconciliation";

export interface MergeDecisionRecord {
  canonicalKey: string;
  fixtureId: string;
  title: string;
  sportCategory: string;
  mergeType: MergeResolutionType;
  confidenceScore: number;
  providers: string[];
  rawItemCount: number;
  reversedHomeAwayDetected: boolean;
  signalsMatched: string[];
}

export interface PreventedMergeRecord {
  keyA: string;
  keyB: string;
  teamPair: string;
  reason:
    | "CONFLICTING_MATCH_NUMBER"
    | "CONFLICTING_FORMAT"
    | "CONFLICTING_STAGE"
    | "CONFLICTING_AGE_GROUP"
    | "CONFLICTING_GENDER"
    | "EXCEEDED_TIME_WINDOW"
    | "INCOMPATIBLE_SPORT";
  details: string;
}

export interface ProviderExtractionAccounting {
  providerKey: string;
  providerName: string;
  rawPayloadCount: number;
  validItemsCount: number;
  excludedItemsCount: number;
  mappedToFixturesCount: number;
  unmappedIds: string[];
  exclusions: CatalogExclusion[];
}

export interface FullReconciliationReport {
  status: "verified_zero_loss" | "degraded_partial_loss";
  generatedAt: string;
  summary: {
    totalProvidersQueried: number;
    healthyProvidersCount: number;
    totalRawPayloadItems: number;
    totalValidItemsExtracted: number;
    totalExcludedInvalidItems: number;
    totalUnifiedFixtures: number;
    activeUnifiedFixtures: number;
    endedUnifiedFixtures: number;
    multiProviderFixturesCount: number;
    deduplicatedItemsMerged: number;
    reconciledCrossFormatCount: number;
    reconciledNearTimeCount: number;
    reconciledNoDateCount: number;
    reversedHomeAwayResolvedCount: number;
    preventedFalseMergesCount: number;
    unmappedRawItemsCount: number;
    averageMergeConfidence: number;
  };
  providerAccounting: ProviderExtractionAccounting[];
  mergeDecisions: MergeDecisionRecord[];
  preventedMerges: PreventedMergeRecord[];
}

export class ReconciliationEngine {
  /**
   * Computes a deterministic confidence score (0.00 - 1.00) and matched signals
   * for a merged fixture cluster.
   */
  static evaluateClusterConfidence(
    fixture: UnifiedFixture,
    candidates: Array<{
      providerKey: string;
      rawId: string;
      name: string;
      sport: string;
      eventInfo?: Record<string, any>;
    }>,
    mergeTypesApplied: Set<MergeResolutionType>,
    reversedHomeAwayDetected: boolean
  ): {
    mergeType: MergeResolutionType;
    confidenceScore: number;
    signalsMatched: string[];
  } {
    const signals: string[] = [];
    let score = 0.85;

    if (fixture.kind === "match" && fixture.teams) {
      signals.push("normalized_team_pair");
      score += 0.05;
    } else {
      signals.push("canonical_channel_identity");
      score += 0.04;
    }

    signals.push(`sport_${fixture.sportCategory}`);

    // Check start time agreement across candidates
    const timestamps: number[] = [];
    for (const c of candidates) {
      if (c.eventInfo?.startTime) {
        const t = new Date(c.eventInfo.startTime).getTime();
        if (!isNaN(t)) timestamps.push(t);
      }
    }
    if (timestamps.length >= 2) {
      const minT = Math.min(...timestamps);
      const maxT = Math.max(...timestamps);
      const diffMinutes = Math.round((maxT - minT) / 60_000);
      if (diffMinutes === 0) {
        signals.push("exact_start_time_utc");
        score += 0.06;
      } else if (diffMinutes <= 60) {
        signals.push(`near_start_time_${diffMinutes}m`);
        score += 0.03;
      } else {
        signals.push(`session_window_${diffMinutes}m`);
      }
    }

    if (fixture.eventDetails?.format) {
      signals.push(`format_${fixture.eventDetails.format}`);
      score += 0.02;
    }
    if (fixture.eventDetails?.ageGroup) {
      signals.push(`age_${fixture.eventDetails.ageGroup}`);
      score += 0.01;
    }
    if (fixture.eventDetails?.gender) {
      signals.push(`gender_${fixture.eventDetails.gender}`);
      score += 0.01;
    }
    if (reversedHomeAwayDetected) {
      signals.push("home_away_reversal_resolved");
    }

    let primaryMergeType: MergeResolutionType = "exact_canonical_key";
    if (mergeTypesApplied.has("cross_format_reconciliation")) {
      primaryMergeType = "cross_format_reconciliation";
      score = Math.min(score, 0.95);
    } else if (mergeTypesApplied.has("near_time_reconciliation")) {
      primaryMergeType = "near_time_reconciliation";
      score = Math.min(score, 0.94);
    } else if (mergeTypesApplied.has("nodate_reconciliation")) {
      primaryMergeType = "nodate_reconciliation";
      score = Math.min(score, 0.92);
    }

    return {
      mergeType: primaryMergeType,
      confidenceScore: Math.min(0.99, Number(score.toFixed(2))),
      signalsMatched: signals,
    };
  }
}
