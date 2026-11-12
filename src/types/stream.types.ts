export interface ClearKeyEntry {
  kid: string;
  key: string;
}

export interface DrmConfiguration {
  type: "clearkey" | "widevine" | "none";
  keys?: ClearKeyEntry[];
}

export interface StreamRendition {
  qualityTag: string; // "Auto", "1080p", "720p", "480p", "360p"
  label: string; // "1080p FHD (50fps)"
  height: number;
  width: number;
  bitrate: number;
  fps: number;
  url: string;
  isDefault?: boolean;
}

export interface LanguageInfo {
  code: string; // "hin", "eng", "ben"
  name: string; // "Hindi", "English"
  badge: string; // "HIN", "ENG"
}

export interface StreamNetworkInfo {
  masterPlaylistUrl: string;
  edgeProxyFallbackUrl?: string | null;
  requiredHeaders?: Record<string, string>;
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
  reason: "DONATION_SPAM" | "MISSING_URL" | "INVALID_SCHEME" | "UNSUPPORTED_PROTOCOL";
  provider: string;
  details: string;
}

export interface StreamAuditSummary {
  totalRawStreams: number;
  validStreamsCount: number;
  excludedStreamsCount: number;
  exclusions: StreamExclusion[];
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
  provenance: StreamProvenance;
  hasPreParsedRenditions: boolean;
  renditions: StreamRendition[];
}

export interface StreamResponse {
  status: "success";
  apiVersion: string;
  fixtureId: string;
  canonicalKey: string;
  generatedAt: string;
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
    audit?: StreamAuditSummary;
  };
  streams: UnifiedStream[];
}
