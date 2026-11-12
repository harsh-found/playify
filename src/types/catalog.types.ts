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
  providerRawIds?: Record<string, string[]>;
  providerCount?: number;
  mergeConfidence?: number;
  mergeSignals?: string[];
}

export interface SportFacet {
  id: string;
  label: string;
  icon: string;
  liveCount: number;
  totalCount: number;
  upcomingCount?: number;
  endedCount?: number;
}

export interface PaginationMetadata {
  totalItems: number;
  returnedItems: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface CatalogQueryOptions {
  sport?: string;
  phase?: string;
  search?: string;
  kind?: string;
  tournament?: string;
  provider?: string;
  hot?: boolean;
  date?: string;
  sort?: "default" | "smart" | "time_asc" | "time_desc" | "popularity" | "title_asc";
  page?: number;
  limit?: number;
  offset?: number;
}

export interface ReconciliationSummary {
  totalProvidersQueried: number;
  healthyProvidersCount: number;
  totalRawItemsExtracted: number;
  totalExcludedInvalidItems?: number;
  totalUnifiedFixtures: number;
  activeUnifiedFixtures: number;
  endedUnifiedFixtures: number;
  multiProviderFixturesCount: number;
  deduplicatedItemsMerged: number;
  reconciledCrossFormatCount: number;
  reconciledNearTimeCount: number;
  reconciledNoDateCount?: number;
  reversedHomeAwayResolvedCount?: number;
  preventedFalseMergesCount?: number;
  averageMergeConfidence?: number;
  unmappedRawItemsCount: number;
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
    totalEndedMatches?: number;
  };
  pagination?: PaginationMetadata;
  reconciliation?: ReconciliationSummary;
  fixtures: UnifiedFixture[];
}

export interface CompetitionSummary {
  id: string;
  name: string;
  shortName: string;
  sportCategory: string;
  sportLabel: string;
  logo: string;
  liveMatchesCount: number;
  upcomingMatchesCount: number;
  endedMatchesCount: number;
  totalFixturesCount: number;
  providers: string[];
  sampleTeams: string[];
  nextMatchTimeUtc?: string;
}

export interface CompetitionsResponse {
  status: "success";
  apiVersion: string;
  timestamp: string;
  totalCompetitions: number;
  competitions: CompetitionSummary[];
}

export interface CompetitionDetailResponse {
  status: "success";
  apiVersion: string;
  timestamp: string;
  competition: CompetitionSummary;
  fixtures: UnifiedFixture[];
}

export interface TeamSummary {
  id: string;
  name: string;
  code: string;
  logo: string;
  sportCategory: string;
  sportLabel: string;
  liveMatchesCount: number;
  upcomingMatchesCount: number;
  totalFixturesCount: number;
  competitions: string[];
  nextMatchTimeUtc?: string;
}

export interface TeamsResponse {
  status: "success";
  apiVersion: string;
  timestamp: string;
  totalTeams: number;
  teams: TeamSummary[];
}

export interface TeamDetailResponse {
  status: "success";
  apiVersion: string;
  timestamp: string;
  team: TeamSummary;
  fixtures: UnifiedFixture[];
}

export interface TimelineBucket {
  id: "live_now" | "starting_soon_2h" | "later_today" | "tomorrow" | "upcoming_later";
  label: string;
  count: number;
  fixtures: UnifiedFixture[];
}

export interface TimelineResponse {
  status: "success";
  apiVersion: string;
  timestamp: string;
  executionTimeMs: number;
  totalActiveEvents: number;
  buckets: TimelineBucket[];
}

export interface SearchEntityResult {
  status: "success";
  apiVersion: string;
  timestamp: string;
  query: string;
  executionTimeMs: number;
  counts: {
    fixtures: number;
    teams: number;
    competitions: number;
    broadcasters: number;
  };
  results: {
    fixtures: UnifiedFixture[];
    teams: Array<TeamEntity & { sportCategory: string; activeFixturesCount: number }>;
    competitions: CompetitionSummary[];
    broadcasters: Array<{ name: string; activeFixturesCount: number; sports: string[] }>;
  };
}
