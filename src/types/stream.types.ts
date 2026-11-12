export interface ClearKeyEntry {
  kid: string;
  key: string;
}

export interface DrmConfiguration {
  type: "clearkey" | "widevine" | "none";
  keys?: ClearKeyEntry[];
  licenseUrl?: string;
}

export interface StreamRendition {
  qualityTag: string; // "Auto", "1080p", "720p", "576p", "540p", "480p", "396p", "360p"
  label: string; // "1080p FHD (50fps)"
  height: number;
  width: number;
  bitrate: number;
  fps: number;
  codecs?: string;
  url: string;
  isDefault?: boolean;
}

export interface LanguageInfo {
  code: string; // "hin", "eng", "ben", "tam", "tel", "urd", "spa", etc.
  name: string; // "Hindi", "English"
  badge: string; // "HIN", "ENG"
}

export interface StreamNetworkInfo {
  masterPlaylistUrl: string;
  directOriginUrl?: string | null;
  isBridgedStream?: boolean;
  edgeProxyFallbackUrl?: string | null;
  requiredHeaders?: Record<string, string>;
}

export interface StreamPlaybackHints {
  webHlsCompatible: boolean;
  directDashAvailable: boolean;
  requiresClearKey: boolean;
  requiresCustomHeaders: boolean;
  recommendedPlayer: "hls.js" | "shaka-player" | "mpegts.js" | "native";
}

export interface StreamSourceDetail {
  providerKey: string;
  providerName: string;
  isPrimary: boolean;
}

export interface StreamProvenance {
  originProvider: string;
  originProviderName: string;
  mirroredBy: string[];
  isMultiSource: boolean;
  isExclusive: boolean;
  sourceList: StreamSourceDetail[];
  attributionBadge: string;
}

export interface StreamExclusion {
  reason:
    | "DONATION_SPAM"
    | "MISSING_URL"
    | "INVALID_SCHEME"
    | "UNSUPPORTED_PROTOCOL"
    | "NON_MEDIA_URL";
  provider: string;
  details: string;
}

export interface StreamAuditSummary {
  totalRawStreams: number;
  validStreamsCount: number;
  excludedStreamsCount: number;
  exclusions: StreamExclusion[];
}

export interface StreamProviderAccounting {
  providerKey: string;
  providerName: string;
  rawIdsQueried: number;
  rawStreamsReturned: number;
  status: "ok" | "empty" | "failed";
  latencyMs: number;
}

export interface UnifiedStream {
  streamId: string;
  channelName: string;
  channelGroup: string;
  priorityTier: "primary" | "secondary" | "tertiary";
  reliabilityScore: number;
  sourceConfidence?: number;
  confidenceTier?: "high" | "medium" | "standard";
  qualityVariant?: string;
  language: LanguageInfo;
  protocol: "hls" | "dash" | "mp4";
  drm: DrmConfiguration | null;
  network: StreamNetworkInfo;
  playbackHints?: StreamPlaybackHints;
  provenance: StreamProvenance;
  hasPreParsedRenditions: boolean;
  renditions: StreamRendition[];
}

export interface ChannelMirrorGroup {
  channelName: string;
  channelGroup: string;
  language: LanguageInfo;
  recommendedStreamId: string;
  totalMirrors: number;
  providers: string[];
  qualities: string[];
  hasDrm: boolean;
  streamIds: string[];
}

export interface StreamFilterOptions {
  language?: string;
  quality?: string;
  protocol?: string;
  provider?: string;
  channel?: string;
  drmFree?: boolean;
  playableOn?: "web_hls" | "all";
  inspectHls?: boolean;
}

export interface StreamResponse {
  status: "success";
  apiVersion: string;
  fixtureId: string;
  canonicalKey: string;
  generatedAt: string;
  totalStreams?: number;
  availableResolutions?: string[];
  edge: {
    region: string;
    cached: boolean;
    ttlSeconds: number;
  };
  summary: {
    totalProvidersQueried: number;
    totalRawStreamsFound: number;
    deduplicatedStreamsCount: number;
    recommendedDefaultStreamId: string;
    availableLanguages?: string[];
    availableQualities?: string[];
    availableResolutions?: string[];
    channelGroups?: string[];
    mirrorGroups?: ChannelMirrorGroup[];
    providersBreakdown?: StreamProviderAccounting[];
    audit?: StreamAuditSummary;
  };
  streams: UnifiedStream[];
}

