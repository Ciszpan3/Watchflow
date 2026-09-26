export type WatchIntent = "learn" | "relax" | "inspire" | "company" | "solve" | "entertain";
export type SourceMode = "subscribed" | "mixed" | "new";
export type VideoFormat = "standard" | "short" | "live" | "podcast";
export type LanguageCode = "en" | "pl";
export type OnboardingStatus = "not_started" | "in_progress" | "completed" | "skipped";
export type RecommendationMode = "session" | "single";
export type MaxAgeMonths = 1 | 3 | 6 | 12 | 24 | null;
export type FitTier = "excellent" | "strong" | "good" | "exploratory";
export type QueueSort = "saved_newest" | "saved_oldest" | "published_newest" | "published_oldest" | "shortest" | "longest";

export type ViewerProfile = {
  version: 2;
  status: OnboardingStatus;
  interests: string[];
  customTopics: string[];
  excludedTopics: string[];
  languages: LanguageCode[];
  formats: VideoFormat[];
  defaultSource: SourceMode;
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
  publishedAt: string | null;
  intents: WatchIntent[];
  source: Exclude<SourceMode, "mixed">;
  channelSubscribed: boolean;
  topics: string[];
  language: LanguageCode;
  format: VideoFormat;
  likedAffinity: number;
  baseReason: string;
  signals: string[];
};

export type ScoredRecommendation = Recommendation & {
  fit: FitTier;
  reason: string;
  recommendationSignals: string[];
  youtubeUrl?: string;
};

export type RecommendationSessionRequest = {
  minutes: number;
  timeLimitEnabled: boolean;
  recommendationMode: RecommendationMode;
  intent: WatchIntent;
  source: SourceMode;
  topics: string[];
  formats: VideoFormat[];
  languages: LanguageCode[];
  maxAgeMonths: MaxAgeMonths;
  audioFriendly: boolean;
  antiClickbait: boolean;
};

export type QueueItem = ScoredRecommendation & {
  savedAt: string;
};

export type RecommendationSessionResponse = {
  mode: "demo" | "live";
  sessionId: string;
  chainId: string;
  totalMinutes: number;
  naturalEnd: boolean;
  request: RecommendationSessionRequest;
  page: number;
  hasMore: boolean;
  recommendationMode: RecommendationMode;
  seenVideoIds: string[];
  items: ScoredRecommendation[];
  emptyReason?: "no_source_matches" | "no_filter_matches" | "no_fresh_matches" | "quota_limited";
  quotaLimited?: boolean;
};
