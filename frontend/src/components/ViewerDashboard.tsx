import React from "react";
import {
  BarChart3,
  Bookmark,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Compass,
  Lightbulb,
  ListVideo,
  LoaderCircle,
  LogOut,
  Menu,
  Play,
  RefreshCcw,
  Route,
  Search,
  SlidersHorizontal,
  Sparkles,
  Telescope,
  ThumbsDown,
  Trash2,
  UserCheck,
  UserRound,
  Users,
  WandSparkles,
  X,
  Youtube
} from "lucide-react";
import { apiBaseUrl } from "../api";
import {
  createDemoSession,
  interestOptions,
  queueItems,
  recommendations
} from "../viewerData";
import {
  createRecommendationSession,
  createNextRecommendationSession,
  defaultViewerProfile,
  deleteViewerAccount,
  disconnectYoutube,
  getAuthSession,
  getLiveViewerProfile,
  getLiveViewerSignals,
  getQueue,
  getLatestRecommendationSession,
  getSessionDraft,
  getViewerProfile,
  getViewerSignals,
  logout,
  migrateLocalProfile,
  recordOpened,
  removeFromQueue,
  requestLiveSync,
  saveLiveViewerProfile,
  saveLatestRecommendationSession,
  saveSessionDraft,
  saveToQueue,
  sendFeedback,
  saveViewerProfile
} from "../viewerApi";
import type {
  AuthSession,
  LanguageCode,
  MaxAgeMonths,
  QueueItem,
  QueueSort,
  RecommendationMode,
  RecommendationSessionRequest,
  ScoredRecommendation,
  SourceMode,
  VideoFormat,
  ViewerProfile,
  ViewerSignalsSummary,
  WatchIntent
} from "../viewerTypes";
import { OnboardingModal } from "./OnboardingModal";

const navItems = [
  { id: "for-you", label: "For You", icon: Sparkles },
  { id: "discover", label: "Discover", icon: Search },
  { id: "queue", label: "My Queue", icon: ListVideo },
  { id: "paths", label: "Learning Paths", icon: Route },
  { id: "taste", label: "Taste Profile", icon: SlidersHorizontal }
];

const intentOptions: { value: WatchIntent; label: string; note: string }[] = [
  { value: "learn", label: "Learn something", note: "Clear and useful" },
  { value: "relax", label: "Switch off", note: "Calm and visual" },
  { value: "inspire", label: "Get inspired", note: "Fresh ideas" },
  { value: "company", label: "Keep me company", note: "Easy to follow" },
  { value: "solve", label: "Solve a problem", note: "Practical answers" },
  { value: "entertain", label: "Have some fun", note: "Worth your break" }
];

const sourceOptions: { value: SourceMode; label: string; note: string; icon: typeof Users }[] = [
  { value: "subscribed", label: "Subscriptions", note: "Channels you know", icon: UserCheck },
  { value: "mixed", label: "Balanced", note: "Known + new", icon: Users },
  { value: "new", label: "New creators", note: "Explore further", icon: Telescope }
];

const formatLabels: Record<VideoFormat, string> = { standard: "Standard", short: "Shorts", live: "Live", podcast: "Podcasts" };
const languageLabels: Record<LanguageCode, string> = { en: "English", pl: "Polish" };
const fitLabels = { excellent: "Excellent fit", strong: "Strong fit", good: "Good fit", exploratory: "Exploratory pick" } as const;
const ageOptions: Array<{ value: MaxAgeMonths; label: string }> = [
  { value: 1, label: "30 days" }, { value: 3, label: "3 months" }, { value: 6, label: "6 months" },
  { value: 12, label: "12 months" }, { value: 24, label: "24 months" }, { value: null, label: "Any age" }
];
const queueSortOptions: Array<{ value: QueueSort; label: string }> = [
  { value: "saved_newest", label: "Recently saved" }, { value: "saved_oldest", label: "Saved longest ago" },
  { value: "published_newest", label: "Newest published" }, { value: "published_oldest", label: "Oldest published" },
  { value: "shortest", label: "Shortest first" }, { value: "longest", label: "Longest first" }
];
const feedbackReasons = [
  { id: "already_watched" as const, label: "I already watched it" },
  { id: "not_interested" as const, label: "Not interested in this topic" },
  { id: "too_long" as const, label: "Too long right now" },
  { id: "too_often" as const, label: "I see this channel too often" }
];
type Toast = { message: string; tone?: "success" | "info" };

const initialRequest: RecommendationSessionRequest = {
  minutes: 45,
  timeLimitEnabled: true,
  recommendationMode: "session",
  intent: "learn",
  source: defaultViewerProfile.defaultSource,
  topics: [],
  formats: defaultViewerProfile.formats,
  languages: defaultViewerProfile.languages,
  maxAgeMonths: 12,
  audioFriendly: defaultViewerProfile.audioFriendly,
  antiClickbait: defaultViewerProfile.antiClickbait
};

function SafeImage({ src, alt = "", className, fallback }: { src: string; alt?: string; className?: string; fallback?: React.ReactNode }) {
  const [failed, setFailed] = React.useState(!src);
  React.useEffect(() => setFailed(!src), [src]);
  if (failed) return <span className={`image-fallback ${className ?? ""}`} aria-label={alt || undefined}>{fallback ?? <Youtube />}</span>;
  return <img className={className} src={src} alt={alt} onError={() => setFailed(true)} />;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "WF";
}

const initialSignals: ViewerSignalsSummary = {
  mode: "demo",
  connected: false,
  subscriptions: { state: "available", detail: "Connect YouTube to make this signal available." },
  likedVideos: { state: "available", detail: "Connect YouTube to make this signal available." },
  watchHistory: { state: "unavailable", detail: "Not available through the YouTube Data API." },
  watchLater: { state: "unavailable", detail: "Not available through the YouTube Data API." }
};

function Sidebar({ open, active, session, mode, connected, signals, queueCount, syncing, onSync, onLogout, onClose, onNavigate }: {
  open: boolean; active: string; session: AuthSession | null; mode: "demo" | "live"; connected: boolean; signals: ViewerSignalsSummary; queueCount: number; syncing: boolean; onSync: () => void; onLogout: () => void; onClose: () => void; onNavigate: (id: string) => void;
}) {
  const viewer = session?.authenticated ? session.user : null;
  return (
    <>
      <aside className={`viewer-sidebar ${open ? "open" : ""}`} aria-label="Main navigation">
        <div className="viewer-brand"><span className="viewer-brand-mark"><Compass /></span><span>Watchflow</span><button className="icon-button mobile-only" type="button" onClick={onClose} aria-label="Close navigation"><X /></button></div>
        <div className="demo-profile"><span className="profile-avatar">{viewer?.avatarUrl ? <SafeImage src={`${apiBaseUrl}${viewer.avatarUrl}`} alt={`${viewer.displayName} profile`} fallback={<b>{initials(viewer.displayName)}</b>} /> : viewer ? <b>{initials(viewer.displayName)}</b> : <UserRound />}</span><div><strong>{viewer?.displayName ?? "Guest profile"}</strong><span>{mode === "live" ? "Live taste profile" : "Local demo profile"}</span></div></div>
        <nav>
          <span className="nav-label">Watch</span>
          {navItems.map((item) => { const Icon = item.icon; return <a key={item.id} className={active === item.id ? "active" : ""} href={`#${item.id}`} onClick={() => { onNavigate(item.id); onClose(); }}><Icon /><span>{item.label}</span>{item.id === "queue" && <small>{queueCount}</small>}</a>; })}
          <span className="nav-label secondary-label">Optional tools</span>
          <a href="#creator-tools" onClick={() => { onNavigate("creator-tools"); onClose(); }}><BarChart3 /><span>Creator insights</span><small className="soon">Later</small></a>
        </nav>
        <div className="sidebar-connection"><div><span className={`connection-dot ${connected ? "connected" : ""}`} /><strong>{signals.needsReconnect ? "Reconnect required" : connected ? "YouTube connected" : "Demo recommendations"}</strong></div><p>{connected ? (signals.lastSyncedAt ? `Synced ${new Date(signals.lastSyncedAt).toLocaleString()}` : "Ready for the first import.") : "Connect to personalize with supported YouTube signals."}</p>{connected ? <><button className="sidebar-connect" type="button" onClick={onSync} disabled={syncing}>{syncing ? <LoaderCircle className="spin" /> : <RefreshCcw />}{syncing ? "Syncing" : "Sync now"}</button><button className="sidebar-account-action" type="button" onClick={onLogout}><LogOut />Log out</button></> : <a className="sidebar-connect" href={`${apiBaseUrl}/api/auth/google`}><Youtube />{signals.needsReconnect ? "Reconnect YouTube" : "Connect YouTube"}</a>}</div>
      </aside>
      <button className={`sidebar-scrim ${open ? "visible" : ""}`} type="button" onClick={onClose} aria-label="Close navigation" />
    </>
  );
}

function RecommendationCard({ video, saved, live, onSave, onPlay, onReject }: {
  video: ScoredRecommendation; saved: boolean; live: boolean; onSave: () => void; onPlay: () => void; onReject: () => void;
}) {
  return (
    <article className="recommendation-card">
      <div className="video-image-wrap"><SafeImage src={video.image} alt="" /><span className="duration-badge">{video.duration}:00</span><span className={`match-badge ${video.fit}`}><Sparkles />{fitLabels[video.fit]}</span><span className={`source-badge ${video.source}`}>{video.source === "subscribed" ? <UserCheck /> : <Telescope />}{video.source === "subscribed" ? "Subscribed" : "New creator"}</span></div>
      <div className="recommendation-copy">
        <div className="video-meta"><span>{video.channel}</span><i /><span>{video.views}</span><i /><span>{video.published}</span></div>
        <h3>{video.title}</h3>
        <div className="signal-row">{video.recommendationSignals.map((signal) => <span key={signal}>{signal}</span>)}</div>
        <div className="why-box"><Lightbulb /><p><strong>Why this fits</strong>{video.reason}</p></div>
        <div className="card-actions"><button className="button primary" type="button" onClick={onPlay}><Play fill="currentColor" />{live ? "Watch on YouTube" : "Play demo"}</button><button className={`icon-button bordered ${saved ? "saved" : ""}`} type="button" onClick={onSave} aria-label={saved ? "Remove from queue" : "Save to queue"}>{saved ? <Check /> : <Bookmark />}</button><button className="icon-button quiet" type="button" onClick={onReject} aria-label="Not for me"><ThumbsDown /></button></div>
      </div>
    </article>
  );
}

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function sortQueueItems(items: QueueItem[], sort: QueueSort) {
  const value = (item: QueueItem) => sort.startsWith("saved") ? new Date(item.savedAt).getTime()
    : sort.startsWith("published") ? new Date(item.publishedAt ?? 0).getTime()
      : item.duration;
  const direction = sort === "saved_oldest" || sort === "published_oldest" || sort === "shortest" ? 1 : -1;
  return [...items].sort((left, right) => {
    if (sort.startsWith("published")) {
      if (!left.publishedAt) return 1;
      if (!right.publishedAt) return -1;
    }
    return (value(left) - value(right)) * direction;
  });
}

export function ViewerDashboard() {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [active, setActive] = React.useState("for-you");
  const [mode, setMode] = React.useState<"demo" | "live">("demo");
  const [authSession, setAuthSession] = React.useState<AuthSession | null>(null);
  const [profile, setProfile] = React.useState<ViewerProfile>(defaultViewerProfile);
  const [signals, setSignals] = React.useState<ViewerSignalsSummary>(initialSignals);
  const [loadingApp, setLoadingApp] = React.useState(true);
  const [syncing, setSyncing] = React.useState(false);
  const [appError, setAppError] = React.useState<string | null>(null);
  const [onboardingOpen, setOnboardingOpen] = React.useState(false);
  const [editingProfile, setEditingProfile] = React.useState(false);
  const [minutes, setMinutes] = React.useState(initialRequest.minutes);
  const [timeLimitEnabled, setTimeLimitEnabled] = React.useState(initialRequest.timeLimitEnabled);
  const [recommendationMode, setRecommendationMode] = React.useState<RecommendationMode>(initialRequest.recommendationMode);
  const [intent, setIntent] = React.useState<WatchIntent>(initialRequest.intent);
  const [source, setSource] = React.useState<SourceMode>(initialRequest.source);
  const [topics, setTopics] = React.useState<string[]>([]);
  const [formats, setFormats] = React.useState<VideoFormat[]>(initialRequest.formats);
  const [languages, setLanguages] = React.useState<LanguageCode[]>(initialRequest.languages);
  const [maxAgeMonths, setMaxAgeMonths] = React.useState<MaxAgeMonths>(initialRequest.maxAgeMonths);
  const [audioFriendly, setAudioFriendly] = React.useState(initialRequest.audioFriendly);
  const [antiClickbait, setAntiClickbait] = React.useState(initialRequest.antiClickbait);
  const [moreFilters, setMoreFilters] = React.useState(false);
  const [building, setBuilding] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);
  const [saveState, setSaveState] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [session, setSession] = React.useState(() => createDemoSession(initialRequest, defaultViewerProfile));
  const [saved, setSaved] = React.useState(() => new Set(queueItems.map((item) => item.id)));
  const [liveQueue, setLiveQueue] = React.useState<QueueItem[]>([]);
  const [demoQueue, setDemoQueue] = React.useState<QueueItem[]>(queueItems);
  const [queueSort, setQueueSort] = React.useState<QueueSort>("saved_newest");
  const [removingVideoId, setRemovingVideoId] = React.useState<string | null>(null);
  const [feedbackVideo, setFeedbackVideo] = React.useState<ScoredRecommendation | null>(null);
  const [toast, setToast] = React.useState<Toast | null>(null);
  const connected = Boolean(authSession?.authenticated && authSession.youtube.connected && mode === "live");

  const applyProfileDefaults = React.useCallback((nextProfile: ViewerProfile) => {
    setSource(nextProfile.defaultSource);
    setFormats(nextProfile.formats);
    setLanguages(nextProfile.languages);
    setMaxAgeMonths(12);
    setAudioFriendly(nextProfile.audioFriendly);
    setAntiClickbait(nextProfile.antiClickbait);
    setTopics([]);
  }, []);

  const applySessionRequest = React.useCallback((request: RecommendationSessionRequest) => {
    setMinutes(request.minutes);
    setTimeLimitEnabled(request.timeLimitEnabled);
    setRecommendationMode(request.recommendationMode);
    setIntent(request.intent);
    setSource(request.source);
    setTopics(request.topics);
    setFormats(request.formats);
    setLanguages(request.languages);
    setMaxAgeMonths(request.maxAgeMonths);
    setAudioFriendly(request.audioFriendly);
    setAntiClickbait(request.antiClickbait);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const oauthSuccess = params.get("oauth") === "success";
      const oauthError = params.get("oauth") === "error";
      if (params.has("oauth") || params.has("reason")) {
        params.delete("oauth");
        params.delete("reason");
        const query = params.toString();
        window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash || "#for-you"}`);
      }
      const localProfile = await getViewerProfile();
      try {
        const backendSession = await getAuthSession();
        if (cancelled) return;
        setAuthSession(backendSession);
        if (backendSession.authenticated) {
          const [profileResponse, liveSignals, queue, draft, latest] = await Promise.all([
            getLiveViewerProfile(), getLiveViewerSignals(), getQueue(), getSessionDraft("live"), getLatestRecommendationSession("live")
          ]);
          const liveProfile = await migrateLocalProfile(localProfile, profileResponse.profile, profileResponse.source);
          if (cancelled) return;
          setMode("live");
          setProfile(liveProfile);
          if (draft.request) applySessionRequest(draft.request); else applyProfileDefaults(liveProfile);
          setSignals(liveSignals);
          setLiveQueue(queue.items);
          setSaved(new Set(queue.items.map((item) => item.id)));
          if (latest.session) setSession(latest.session);
          else setSession({
            mode: "live", sessionId: "initial", chainId: "initial", totalMinutes: 0, naturalEnd: true,
            request: draft.request ?? initialRequest, page: 1, hasMore: false, recommendationMode: "session", seenVideoIds: [], items: []
          });
          if (oauthSuccess && liveProfile.status !== "completed") {
            setEditingProfile(false);
            setOnboardingOpen(true);
          }
          if (backendSession.youtube.connected && liveSignals.stale) {
            const syncResult = await requestLiveSync(false);
            if (syncResult.status === "queued" || syncResult.status === "already_running") setSyncing(true);
          }
        } else {
          const [draft, latest] = await Promise.all([getSessionDraft("demo"), getLatestRecommendationSession("demo")]);
          setProfile(localProfile);
          if (draft.request) applySessionRequest(draft.request); else applyProfileDefaults(localProfile);
          setSignals(await getViewerSignals(false, localProfile));
          setSession(latest.session ?? createDemoSession({ ...initialRequest, source: localProfile.defaultSource, formats: localProfile.formats, languages: localProfile.languages, audioFriendly: localProfile.audioFriendly, antiClickbait: localProfile.antiClickbait }, localProfile));
        }
        if (oauthError) setAppError("Google connection could not be completed. Try connecting again or continue with demo data.");
      } catch (error) {
        if (cancelled) return;
        setProfile(localProfile);
        applyProfileDefaults(localProfile);
        setSignals(await getViewerSignals(false, localProfile));
        setAppError(error instanceof Error ? error.message : "Watchflow could not reach the live service.");
      } finally {
        if (!cancelled) { setLoadingApp(false); setHydrated(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [applyProfileDefaults, applySessionRequest]);

  React.useEffect(() => {
    if (mode !== "live" || (!syncing && !["queued", "running"].includes(signals.sync?.status ?? ""))) return;
    const interval = window.setInterval(() => {
      void getLiveViewerSignals().then((next) => {
        setSignals(next);
        const running = next.sync?.status === "queued" || next.sync?.status === "running";
        setSyncing(running);
        if (!running && next.sync?.status === "succeeded") setToast({ message: `YouTube sync complete: ${next.subscriptions.count ?? 0} subscriptions and ${next.likedVideos.count ?? 0} likes imported.` });
        if (!running && next.sync?.status === "failed") setAppError(next.sync.errorMessage ?? "YouTube synchronization failed.");
      }).catch((error: unknown) => setAppError(error instanceof Error ? error.message : "Could not refresh sync status."));
    }, 1500);
    return () => window.clearInterval(interval);
  }, [mode, signals.sync?.status, syncing]);

  React.useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  React.useEffect(() => {
    if (!hydrated || mode !== "live") return;
    void getQueue(queueSort).then((queue) => setLiveQueue(queue.items)).catch((error: unknown) => setAppError(error instanceof Error ? error.message : "The queue could not be sorted."));
  }, [hydrated, mode, queueSort]);

  const buildRequest = React.useCallback((sourceOverride?: SourceMode): RecommendationSessionRequest => ({
    minutes, timeLimitEnabled, recommendationMode, intent, source: sourceOverride ?? source, topics, formats, languages, maxAgeMonths, audioFriendly, antiClickbait
  }), [antiClickbait, audioFriendly, formats, intent, languages, maxAgeMonths, minutes, recommendationMode, source, timeLimitEnabled, topics]);

  React.useEffect(() => {
    if (!hydrated) return;
    setSaveState("saving");
    const timeout = window.setTimeout(() => {
      void saveSessionDraft(buildRequest(), mode)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [buildRequest, hydrated, mode]);

  async function generateSession(sourceOverride?: SourceMode) {
    setBuilding(true);
    setAppError(null);
    if (sourceOverride) setSource(sourceOverride);
    try {
      const response = await createRecommendationSession(buildRequest(sourceOverride), profile, mode);
      setSession(response);
      saveLatestRecommendationSession(response);
      const expectedCount = response.recommendationMode === "single" ? 5 : 3;
      setToast({ message: response.items.length
        ? response.items.length < expectedCount ? `Found ${response.items.length} fresh matches. Older videos were not used as filler.` : response.recommendationMode === "single" ? "Five fresh alternatives are ready." : "A fresh session is ready. It ends when the last card ends."
        : response.emptyReason === "quota_limited" ? "Today's discovery search limit has been reached. Subscription results remain available."
          : response.emptyReason === "no_fresh_matches" ? "No recent matches are available for these filters. Older videos were left out."
            : "No exact matches yet. Adjust a filter or broaden the source." });
      window.requestAnimationFrame(() => document.querySelector("#discover")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Recommendations could not be created.");
    } finally {
      setBuilding(false);
    }
  }

  async function nextSet() {
    setBuilding(true);
    setAppError(null);
    try {
      const response = await createNextRecommendationSession(session, profile);
      setSession(response);
      saveLatestRecommendationSession(response);
      setToast({ message: response.items.length ? `Set ${response.page} is ready with no repeats.` : "No more matches for these filters." });
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "The next set could not be created.");
    } finally {
      setBuilding(false);
    }
  }

  function resetToProfile() {
    applyProfileDefaults(profile);
    setToast({ message: "Session filters reset to your taste profile." });
  }

  async function toggleSaved(video: ScoredRecommendation) {
    const removing = saved.has(video.id);
    const queuedItem: QueueItem = "savedAt" in video ? video as QueueItem : { ...video, savedAt: new Date().toISOString() };
    const updateQueue = mode === "live" ? setLiveQueue : setDemoQueue;
    setRemovingVideoId(removing ? video.id : null);
    updateQueue((current) => removing ? current.filter((item) => item.id !== video.id) : [queuedItem, ...current]);
    setSaved((current) => { const next = new Set(current); if (removing) next.delete(video.id); else next.add(video.id); return next; });
    try {
      if (mode === "live") {
        if (removing) await removeFromQueue(video.id); else await saveToQueue(video.id);
      }
      setToast({ message: removing ? "Removed from your queue." : "Saved to your queue." });
    } catch (error) {
      updateQueue((current) => removing ? [queuedItem, ...current] : current.filter((item) => item.id !== video.id));
      setSaved((current) => { const next = new Set(current); if (removing) next.add(video.id); else next.delete(video.id); return next; });
      setAppError(error instanceof Error ? error.message : "The queue could not be updated.");
    } finally {
      setRemovingVideoId(null);
    }
  }

  const persistProgress = React.useCallback((draft: ViewerProfile) => { void (mode === "live" ? saveLiveViewerProfile(draft) : saveViewerProfile(draft)); }, [mode]);
  const closeOnboarding = React.useCallback(() => setOnboardingOpen(false), []);
  const completeOnboarding = React.useCallback(async (draft: ViewerProfile) => {
    try {
      const savedProfile = await (mode === "live" ? saveLiveViewerProfile(draft) : saveViewerProfile(draft));
      setProfile(savedProfile);
      applyProfileDefaults(savedProfile);
      setSignals(mode === "live" ? await getLiveViewerSignals() : await getViewerSignals(false, savedProfile));
      setOnboardingOpen(false);
      setEditingProfile(false);
      setToast({ message: "Your taste profile is ready and stays fully editable." });
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Your taste profile could not be saved.");
      throw error;
    }
  }, [applyProfileDefaults, mode]);
  const skipOnboarding = React.useCallback((draft: ViewerProfile) => {
    void (mode === "live" ? saveLiveViewerProfile(draft) : saveViewerProfile(draft)).then(async (savedProfile) => {
      setProfile(savedProfile);
      setSignals(mode === "live" ? await getLiveViewerSignals() : await getViewerSignals(false, savedProfile));
      setOnboardingOpen(false);
      setToast({ message: "Setup skipped. Balanced defaults will stay active." });
    });
  }, [mode]);

  async function syncNow() {
    setAppError(null);
    setSyncing(true);
    try {
      const result = await requestLiveSync(true);
      if (result.status === "fresh") setToast({ message: "Your YouTube data is already fresh." });
      if (result.status === "queued" || result.status === "already_running") setToast({ message: "YouTube synchronization started." });
      setSignals(await getLiveViewerSignals());
    } catch (error) {
      setSyncing(false);
      setAppError(error instanceof Error ? error.message : "Synchronization could not be started.");
    }
  }

  function useDemoData() {
    void getViewerProfile().then(async (localProfile) => {
      const [draft, latest] = await Promise.all([getSessionDraft("demo"), getLatestRecommendationSession("demo")]);
      setMode("demo");
      setProfile(localProfile);
      if (draft.request) applySessionRequest(draft.request); else applyProfileDefaults(localProfile);
      setSignals(await getViewerSignals(false, localProfile));
      setSession(latest.session ?? createDemoSession(initialRequest, localProfile));
      setSaved(new Set(["city-history", "woodworking"]));
      setAppError(null);
      setToast({ message: "Demo mode is active. Live account data is kept separate." });
    });
  }

  async function logOutViewer() {
    try { await logout(); } finally { window.location.reload(); }
  }

  async function openVideo(video: ScoredRecommendation) {
    if (mode === "live" && video.youtubeUrl) {
      window.open(video.youtubeUrl, "_blank", "noopener,noreferrer");
      void recordOpened(video.id).catch(() => undefined);
      return;
    }
    setToast({ message: `Demo player: “${video.title}” would open on YouTube.`, tone: "info" });
  }

  async function submitFeedback(video: ScoredRecommendation, reason: typeof feedbackReasons[number]) {
    try {
      if (mode === "live") await sendFeedback(video.id, reason.id);
      setSession((current) => ({ ...current, items: current.items.filter((item) => item.id !== video.id), totalMinutes: Math.max(0, current.totalMinutes - video.duration) }));
      setFeedbackVideo(null);
      setToast({ message: `Got it: ${reason.label.toLowerCase()}.` });
    } catch (error) {
      setAppError(error instanceof Error ? error.message : "Feedback could not be saved.");
    }
  }

  const activeFilterLabels = [
    recommendationMode === "session" ? "Watch session" : "Single video",
    timeLimitEnabled ? `${minutes} min` : "No time limit",
    ...topics.map((topic) => interestOptions.find((item) => item.id === topic)?.label ?? topic),
    formats.length < 4 ? formats.map((format) => formatLabels[format]).join(" + ") : "All formats",
    languages.map((language) => languageLabels[language]).join(" + "),
    audioFriendly ? "Audio-friendly" : null,
    antiClickbait ? "Anti-clickbait" : null
  ].filter(Boolean) as string[];
  const displayedQueue = sortQueueItems(mode === "live" ? liveQueue : demoQueue, queueSort);
  const filtersChanged = JSON.stringify(session.request) !== JSON.stringify(buildRequest());

  if (loadingApp) {
    return <div className="viewer-loading" role="status"><span className="viewer-brand-mark"><Compass /></span><LoaderCircle className="spin" /><strong>Loading your Watchflow…</strong><p>Checking your secure session and recommendation profile.</p></div>;
  }

  return (
    <div className="viewer-shell">
      <Sidebar open={menuOpen} active={active} session={authSession} mode={mode} connected={connected} signals={signals} queueCount={saved.size} syncing={syncing} onSync={() => void syncNow()} onLogout={() => void logOutViewer()} onClose={() => setMenuOpen(false)} onNavigate={setActive} />
      <div className="mobile-topbar"><button className="icon-button" type="button" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu /></button><span className="viewer-brand compact"><span className="viewer-brand-mark"><Compass /></span>Watchflow</span><a className="mobile-queue" href="#queue" aria-label={`${saved.size} saved videos`}><Bookmark /><small>{saved.size}</small></a></div>

      <main className="viewer-main">
        <header className="viewer-header"><div><span className="eyebrow">Personal discovery</span><h1>Good evening{authSession?.authenticated ? `, ${authSession.user.displayName.split(" ")[0]}` : ""}</h1><p>Let’s find one thing worth your time.</p></div>{connected ? <button className="connected-pill" type="button" onClick={() => void syncNow()} disabled={syncing}>{syncing ? <LoaderCircle className="spin" /> : <CheckCircle2 />}{syncing ? (signals.sync?.phase.replaceAll("_", " ") ?? "Syncing") : "YouTube connected"}</button> : <a className="button secondary connect-button" href={`${apiBaseUrl}/api/auth/google`}><Youtube />{signals.needsReconnect ? "Reconnect YouTube" : "Connect YouTube"}</a>}</header>

        {appError && <aside className="live-error" role="alert"><div><strong>Live data needs attention</strong><p>{appError}</p></div><button className="button secondary" type="button" onClick={() => window.location.reload()}><RefreshCcw />Retry</button>{mode === "live" && <button className="button text-button" type="button" onClick={useDemoData}>Use demo data</button>}</aside>}

        {mode === "live" && signals.sync && ["queued", "running"].includes(signals.sync.status) && <aside className="sync-progress" role="status"><LoaderCircle className="spin" /><div><strong>Importing your YouTube signals</strong><p>{signals.sync.phase.replaceAll("_", " ")} · {signals.sync.subscriptionsCount} subscriptions · {signals.sync.likedVideosCount} likes · {signals.sync.candidatesCount} candidates</p></div></aside>}

        {(profile.status === "skipped" || profile.status === "in_progress") && <aside className="profile-nudge"><Sparkles /><div><strong>Make these recommendations feel more like yours</strong><p>Your taste setup is {profile.status === "in_progress" ? "partly complete" : "using balanced defaults"}. Finish it in about a minute.</p></div><button className="button secondary" type="button" onClick={() => { setEditingProfile(false); setOnboardingOpen(true); }}>Finish setup</button></aside>}

        <section className="intent-panel" id="for-you">
          <div className="intent-heading"><div><span className="section-kicker"><WandSparkles />Build a viewing session</span><h2>What do you want to watch right now?</h2><p>Set the moment. Your taste profile takes care of the rest.</p></div><div className="composer-status"><span className={`save-state ${saveState}`}><span />{saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn't save" : saveState === "saved" ? "Preferences saved" : "Ready"}</span><span className={`demo-label ${mode === "live" ? "live" : ""}`}><span />{mode === "live" ? "Live YouTube data" : "Interactive demo"}</span></div></div>

          <div className="composer-layout">
            <fieldset className="control-group time-control"><legend>How should time shape the results?</legend><div className="time-control-header"><div className="mode-segment" role="group" aria-label="Recommendation mode"><button className={recommendationMode === "session" ? "selected" : ""} type="button" onClick={() => setRecommendationMode("session")}><ListVideo />Watch session</button><button className={recommendationMode === "single" ? "selected" : ""} type="button" onClick={() => setRecommendationMode("single")}><Play />Single video</button></div><label className="time-limit-toggle"><input type="checkbox" checked={timeLimitEnabled} onChange={(event) => setTimeLimitEnabled(event.target.checked)} /><i /><span><strong>Use time limit</strong><small>{timeLimitEnabled ? "Duration affects these picks" : "Show the strongest matches"}</small></span></label></div>{timeLimitEnabled && <div className="time-picker"><div className="time-options">{[15, 30, 45, 60].map((value) => <button key={value} className={minutes === value ? "selected" : ""} type="button" onClick={() => setMinutes(value)}><Clock3 />{value} min</button>)}</div><label className="custom-time"><span>Custom</span><input type="number" min="5" max="180" value={minutes} onChange={(event) => setMinutes(Math.min(180, Math.max(5, Number(event.target.value) || 5)))} /><small>min</small></label></div>}<p className="time-help">{recommendationMode === "session" ? timeLimitEnabled ? "Up to three videos whose combined length fits your time." : "Three strong recommendations without duration affecting the ranking." : timeLimitEnabled ? "Five alternatives close to this length, not a combined playlist." : "Five strong standalone alternatives of any length."}</p></fieldset>
            <fieldset className="control-group"><legend>What do you need?</legend><div className="intent-options expanded">{intentOptions.map((option) => <button key={option.value} className={intent === option.value ? "selected" : ""} type="button" onClick={() => setIntent(option.value)}><strong>{option.label}</strong><span>{option.note}</span></button>)}</div></fieldset>
            <fieldset className="control-group"><legend>Where should we look?</legend><div className="source-options">{sourceOptions.map((option) => { const Icon = option.icon; return <button key={option.value} className={source === option.value ? "selected" : ""} type="button" onClick={() => setSource(option.value)}><Icon /><span><strong>{option.label}</strong><small>{option.note}</small></span>{source === option.value && <Check />}</button>; })}</div></fieldset>

            <div className="filters-summary"><div><span>Active filters</span><div>{activeFilterLabels.slice(0, 4).map((label) => <small key={label}>{label}</small>)}{activeFilterLabels.length > 4 && <small>+{activeFilterLabels.length - 4}</small>}</div></div><div><button type="button" onClick={resetToProfile}><RefreshCcw />Reset</button><button type="button" aria-expanded={moreFilters} onClick={() => setMoreFilters((value) => !value)}>More filters<ChevronDown className={moreFilters ? "rotated" : ""} /></button></div></div>

            {moreFilters && <div className="advanced-filters">
              <fieldset><legend>Topic for this session</legend><div className="filter-chip-row">{interestOptions.map((option) => <button key={option.id} className={topics.includes(option.id) ? "selected" : ""} type="button" onClick={() => setTopics((current) => toggleValue(current, option.id))}>{topics.includes(option.id) && <Check />}{option.label}</button>)}</div></fieldset>
              <div className="filter-columns"><fieldset><legend>Formats</legend><div className="filter-chip-row compact">{(Object.keys(formatLabels) as VideoFormat[]).map((format) => <button key={format} className={formats.includes(format) ? "selected" : ""} type="button" onClick={() => setFormats((current) => toggleValue(current, format))}>{formatLabels[format]}</button>)}</div></fieldset><fieldset><legend>Languages</legend><div className="filter-chip-row compact">{(Object.keys(languageLabels) as LanguageCode[]).map((language) => <button key={language} className={languages.includes(language) ? "selected" : ""} type="button" onClick={() => setLanguages((current) => toggleValue(current, language))}>{languageLabels[language]}</button>)}</div></fieldset></div>
              <fieldset><legend>Published within</legend><div className="filter-chip-row compact age-filter">{ageOptions.map((option) => <button key={option.label} className={maxAgeMonths === option.value ? "selected" : ""} type="button" onClick={() => setMaxAgeMonths(option.value)}>{option.label}</button>)}</div><small className="filter-help">This is a strict limit. Watchflow will not fill the set with older videos.</small></fieldset>
              <div className="filter-columns toggles"><label className="toggle-row"><span><Brain /><span><strong>Audio-friendly</strong><small>Works without watching closely</small></span></span><input type="checkbox" checked={audioFriendly} onChange={(event) => setAudioFriendly(event.target.checked)} /><i /></label><label className="toggle-row"><span><CheckCircle2 /><span><strong>Anti-clickbait filter</strong><small>Prefer accurate titles</small></span></span><input type="checkbox" checked={antiClickbait} onChange={(event) => setAntiClickbait(event.target.checked)} /><i /></label></div>
            </div>}
            <button className="button primary build-button" type="button" onClick={() => void generateSession()} disabled={building || !formats.length || !languages.length}>{building ? <LoaderCircle className="spin" /> : <Sparkles />}{building ? "Finding the best matches…" : recommendationMode === "single" ? "Find video alternatives" : "Build my session"}</button>
          </div>
        </section>

        <section className="session-section" id="discover">
          <div className="section-header"><div><span className="section-kicker">Made for this moment · Set {session.page}</span><h2>{session.items.length ? session.recommendationMode === "single" ? `${session.items.length} video alternatives` : `Your ${session.totalMinutes}-minute session` : session.page > 1 ? "No more matches" : session.emptyReason === "no_fresh_matches" ? "No recent matches" : "No exact matches yet"}</h2><p>{session.items.length ? session.items.length < (session.recommendationMode === "single" ? 5 : 3) ? "These are all current matches available. Older videos were not used as filler." : session.recommendationMode === "single" ? "Choose one. Each card is a standalone option." : `${session.items.length} focused picks, ordered to flow naturally.` : session.emptyReason === "no_fresh_matches" ? "Try broader filters. Watchflow left outdated videos out of this set." : "Change a filter or broaden the source to continue."}</p>{filtersChanged && session.items.length > 0 && <span className="results-outdated"><Clock3 />Filters changed after this set was generated</span>}</div>{session.items.length > 0 && session.naturalEnd && <div className="session-stop"><Check /><span><strong>Natural stopping point</strong>No endless feed after video {session.items.length}</span></div>}</div>
          {session.items.length ? <>{session.recommendationMode === "session" && <div className="session-timeline" aria-label={`${session.items.length} video session lasting ${session.totalMinutes} minutes`}>{session.items.map((video, index) => <span key={video.id} style={{ flex: video.duration }}><i>{index + 1}</i>{video.duration} min</span>)}<b>Done</b></div>}<div className={`recommendation-grid ${session.recommendationMode === "single" ? "single-mode" : ""}`}>{session.items.map((video) => <RecommendationCard key={video.id} video={video} live={mode === "live"} saved={saved.has(video.id)} onSave={() => void toggleSaved(video)} onPlay={() => void openVideo(video)} onReject={() => setFeedbackVideo(video)} />)}</div><div className="session-actions"><button className="button secondary next-set" type="button" onClick={() => void nextSet()} disabled={building || !session.hasMore}>{building ? <LoaderCircle className="spin" /> : <RefreshCcw />}{building ? "Finding another set…" : session.hasMore ? "Next set" : "No more matches"}</button><small>Previously shown videos will not repeat.</small></div></> : <div className="recommendation-empty"><Search /><strong>{mode === "live" && !signals.lastSyncedAt ? "Sync YouTube before your first live session" : session.page > 1 ? "You reached the end of these matches" : "Nothing fits every choice"}</strong><p>{mode === "live" && !signals.lastSyncedAt ? "Watchflow needs subscriptions and likes before it can rank real videos." : "We will never silently mix in a source you did not choose."}</p><div className="empty-actions">{mode === "live" && !signals.lastSyncedAt ? <button className="button secondary" type="button" onClick={() => void syncNow()} disabled={syncing}><RefreshCcw />Start sync</button> : <button className="button secondary" type="button" onClick={() => document.querySelector("#for-you")?.scrollIntoView({ behavior: "smooth" })}><SlidersHorizontal />Change filters</button>}{source !== "mixed" && <button className="button secondary" type="button" onClick={() => void generateSession("mixed")}><Users />Try Balanced instead</button>}</div></div>}
        </section>

        <div className="utility-grid"><section className="utility-panel queue-panel" id="queue"><div className="section-header compact-header queue-header"><div><span className="section-kicker">Saved-video rescue</span><h2>Worth another look</h2><p>{mode === "live" ? "Your saved recommendations stay here between visits." : "Demo examples of videos that have been waiting too long."}</p></div><div className="queue-tools"><label><span>Sort saved videos</span><select value={queueSort} onChange={(event) => setQueueSort(event.target.value as QueueSort)}>{queueSortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown /></label>{displayedQueue.length > 0 && <button className="button secondary" type="button" onClick={() => void openVideo(displayedQueue[Math.floor(Math.random() * displayedQueue.length)])}><Sparkles />Pick one</button>}</div></div>{displayedQueue.length ? <div className="queue-list">{displayedQueue.map((video) => <article key={video.id}><SafeImage src={video.image} alt="" /><div><span>Saved {new Date(video.savedAt).toLocaleDateString()}</span><h3>{video.title}</h3><p>{video.channel} · {video.duration} min · {video.published}</p></div><div className="queue-actions"><button className="icon-button" type="button" onClick={() => void openVideo(video)} aria-label={`Open ${video.title}`}><ChevronRight /></button><button className="icon-button remove-queue" type="button" onClick={() => void toggleSaved(video)} disabled={removingVideoId === video.id} aria-label={`Remove ${video.title} from queue`}>{removingVideoId === video.id ? <LoaderCircle className="spin" /> : <Trash2 />}</button></div></article>)}</div> : <div className="compact-empty"><Bookmark /><strong>Your queue is empty</strong><p>Save a recommendation and it will remain available here.</p></div>}</section>
          <section className="utility-panel path-panel" id="paths">{mode === "live" ? <div className="feature-unavailable"><Route /><span className="section-kicker">Learning paths</span><h2>Coming after your first sessions</h2><p>Live learning paths are not generated yet. Watchflow will never present demo progress as yours.</p></div> : <><div className="section-header compact-header"><div><span className="section-kicker">Continue learning</span><h2>Understanding the night sky</h2><p>1 of 4 demo steps completed</p></div><span className="path-progress">25%</span></div><div className="path-steps"><div className="complete"><span><Check /></span><div><strong>How to read the night sky</strong><small>Completed · 12 min</small></div></div><div className="current"><span>2</span><div><strong>Why Saturn has rings</strong><small>Up next · 18 min</small></div><Play /></div><div><span>3</span><div><strong>Finding planets from home</strong><small>15 min</small></div></div><div><span>4</span><div><strong>Your first telescope</strong><small>21 min</small></div></div></div></>}</section></div>

        <div className="utility-grid bottom-grid" id="taste"><section className="utility-panel taste-panel profile-summary"><div className="section-header compact-header"><div><span className="section-kicker">Editable taste profile</span><h2>What Watchflow understands</h2><p>{profile.status === "completed" ? `Your ${mode === "live" ? "saved" : "local"} defaults guide every new session.` : "Balanced defaults are active until setup is complete."}</p></div><Brain /></div><div className="profile-summary-grid"><div><span>Interests</span><p>{profile.interests.map((interest) => interestOptions.find((item) => item.id === interest)?.label ?? interest).join(", ") || "Not set"}</p></div><div><span>Languages</span><p>{profile.languages.map((language) => languageLabels[language]).join(", ")}</p></div><div><span>Default source</span><p>{sourceOptions.find((option) => option.value === profile.defaultSource)?.label}</p></div><div><span>YouTube signals</span><p>{profile.useSubscriptions && profile.useLikedVideos ? "Subscriptions + likes" : profile.useSubscriptions ? "Subscriptions" : profile.useLikedVideos ? "Liked videos" : "Explicit profile only"}</p></div></div><button className="button secondary edit-profile" type="button" onClick={() => { setEditingProfile(true); setOnboardingOpen(true); }}><SlidersHorizontal />Edit taste profile</button>{mode === "live" && <div className="account-actions"><button type="button" onClick={() => { if (window.confirm("Disconnect YouTube and remove imported YouTube data? Your taste profile will remain.")) void disconnectYoutube().then(() => window.location.reload()); }}>Disconnect YouTube</button><button className="danger" type="button" onClick={() => { if (window.confirm("Permanently delete your Watchflow account and all stored data?")) void deleteViewerAccount().then(() => window.location.reload()); }}>Delete account</button></div>}</section>
          <section className="utility-panel diet-panel">{mode === "live" ? <div className="feature-unavailable"><BarChart3 /><span className="section-kicker">Content diet</span><h2>Not enough activity yet</h2><p>This view will activate when Watchflow has enough real opens and feedback to summarize your choices.</p></div> : <><div className="section-header compact-header"><div><span className="section-kicker">This week's content diet</span><h2>Balanced, with room to explore</h2><p>Demo visualization based on example activity.</p></div></div><div className="diet-bars"><div><span><b>Learning</b><small>42%</small></span><i><b style={{ width: "42%" }} /></i></div><div><span><b>Relaxation</b><small>28%</small></span><i><b style={{ width: "28%" }} /></i></div><div><span><b>Practical</b><small>19%</small></span><i><b style={{ width: "19%" }} /></i></div><div><span><b>New perspectives</b><small>11%</small></span><i><b style={{ width: "11%" }} /></i></div></div><p className="diet-note"><Lightbulb />This is demo data. Live activity tracking is not implemented.</p></>}</section></div>
        <section className="creator-note" id="creator-tools"><BarChart3 /><div><strong>Creator analytics stays optional</strong><p>Channel performance tools can live here later, without distracting from the viewer-first experience.</p></div><span>Future add-on</span></section>
      </main>

      <OnboardingModal open={onboardingOpen} profile={profile} signals={signals} editing={editingProfile} onProgress={persistProgress} onComplete={completeOnboarding} onSkip={skipOnboarding} onClose={closeOnboarding} />
      {feedbackVideo && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFeedbackVideo(null); }}><div className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title"><button className="icon-button dialog-close" type="button" onClick={() => setFeedbackVideo(null)} aria-label="Close"><X /></button><span className="feedback-icon"><ThumbsDown /></span><h2 id="feedback-title">Help us tune your recommendations</h2><p>Why isn't “{feedbackVideo.title}” right for you?</p><div>{feedbackReasons.map((reason) => <button key={reason.id} type="button" onClick={() => void submitFeedback(feedbackVideo, reason)}>{reason.label}<ChevronRight /></button>)}</div></div></div>}
      {toast && <div className={`toast ${toast.tone ?? "success"}`} role="status"><span className="status-dot" />{toast.message}</div>}
    </div>
  );
}
