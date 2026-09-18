export type WatchIntent = "learn" | "relax" | "inspire" | "company" | "solve" | "entertain";
export type SourceMode = "subscribed" | "mixed" | "new";
export type VideoFormat = "standard" | "short" | "live" | "podcast";
export type LanguageCode = "en" | "pl";
export type OnboardingStatus = "not_started" | "in_progress" | "completed" | "skipped";

export type ViewerProfile = {
  version: 1;
  status: OnboardingStatus;
  interests: string[];
  customTopics: string[];
  excludedTopics: string[];
  languages: LanguageCode[];
  formats: VideoFormat[];
  defaultSource: SourceMode;
  novelty: number;
  depth: number;
  pace: number;
  audioFriendly: boolean;
  antiClickbait: boolean;
  useSubscriptions: boolean;
  useLikedVideos: boolean;
};

export type SignalState = "available" | "ready" | "disabled" | "unavailable" | "pending" | "error";

export type SyncSummary = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  phase: string;
  subscriptionsCount: number;
  likedVideosCount: number;
  candidatesCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type ViewerSignalsSummary = {
  mode: "demo" | "live";
  connected: boolean;
  needsReconnect?: boolean;
  stale?: boolean;
  lastSyncedAt?: string | null;
  subscriptions: { state: SignalState; detail: string; count?: number };
  likedVideos: { state: SignalState; detail: string; count?: number };
  watchHistory: { state: "unavailable"; detail: string };
  watchLater: { state: "unavailable"; detail: string };
  sync?: SyncSummary | null;
};

export type AuthenticatedViewer = {
  id: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
};

export type AuthSession = {
  authenticated: true;
  user: AuthenticatedViewer;
  youtube: { connected: boolean; needsReconnect: boolean; lastSyncedAt: string | null };
  profile: ViewerProfile | null;
} | {
  authenticated: false;
};

export type Recommendation = {
  id: string;
  title: string;
  channel: string;
  image: string;
  duration: number;
  views: string;
  published: string;
  intents: WatchIntent[];
  source: Exclude<SourceMode, "mixed">;
  channelSubscribed: boolean;
  topics: string[];
  language: LanguageCode;
  format: VideoFormat;
  likedAffinity: number;
  novelty: number;
  depth: number;
  baseReason: string;
  signals: string[];
};

export type ScoredRecommendation = Recommendation & {
  match: number;
  reason: string;
  recommendationSignals: string[];
  youtubeUrl?: string;
};

export type RecommendationSessionRequest = {
  minutes: number;
  intent: WatchIntent;
  source: SourceMode;
  topics: string[];
  formats: VideoFormat[];
  languages: LanguageCode[];
  novelty: number;
  depth: number;
  audioFriendly: boolean;
  antiClickbait: boolean;
};

export type RecommendationSessionResponse = {
  mode: "demo" | "live";
  sessionId: string;
  totalMinutes: number;
  naturalEnd: true;
  items: ScoredRecommendation[];
  emptyReason?: "no_source_matches" | "no_filter_matches" | "quota_limited";
  quotaLimited?: boolean;
};
