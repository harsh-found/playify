export interface TeamEntity {
  id: string;
  name: string;
  code: string;
  logo: string;
}

export interface TournamentEntity {
  id: string;
  name: string;
  shortName: string;
  stage?: string;
  logo: string;
  category: string;
}

export interface ScheduleEntity {
  startTimeUtc: string;
  endTimeUtc?: string;
  status: "live" | "upcoming" | "ended";
  liveBadgeText?: string;
  isLive: boolean;
}

export interface ArtworkEntity {
  posterCard: string;
  bannerWide?: string;
  accentColor?: string;
}

export interface StreamSummaryMetadata {
  totalWorkingFeeds: number;
  availableLanguages: string[];
  maxResolution: string;
  primaryBroadcasters: string[];
}

export type FixtureKind = "match" | "tournament_channel" | "show";

export interface UnifiedFixture {
  fixtureId: string;
  canonicalKey: string;
  sport: string;
  sportCategory: string;
  phase: "live" | "upcoming" | "ended";
  kind: FixtureKind;
  isHotMatch: boolean;
  title: string;
  tournament: TournamentEntity;
  teams: {
    home: TeamEntity;
    away: TeamEntity;
  } | null;
  broadcastInfo?: {
    eventName: string;
    badgeText: string;
  };
  schedule: ScheduleEntity;
  artwork: ArtworkEntity;
  streamMetadata: StreamSummaryMetadata;
  eventDetails?: {
    format?: string;
    matchNumber?: string;
    stage?: string;
    gender?: string;
    ageGroup?: string;
  };
  providerPointers: Record<string, string>;
}

export interface SportFacet {
  id: string;
  label: string;
  icon: string;
  liveCount: number;
  totalCount: number;
}

export interface CatalogResponse {
  status: "success";
  apiVersion: string;
  timestamp: string;
  edge: {
    region: string;
    cacheControl: string;
    executionTimeMs: number;
  };
  facets: {
    activeSportFilter?: string;
    activePhaseFilter?: string;
    sports: SportFacet[];
    totalLiveMatches: number;
    totalUpcomingMatches: number;
  };
  fixtures: UnifiedFixture[];
}
