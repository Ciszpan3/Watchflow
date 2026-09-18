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
  Menu,
  Play,
  RefreshCcw,
  Route,
  Search,
  SlidersHorizontal,
  Sparkles,
  Telescope,
  ThumbsDown,
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
  defaultViewerProfile,
  getStoredConnection,
  getViewerProfile,
  getViewerSignals,
  saveStoredConnection,
  saveViewerProfile
} from "../viewerApi";
import type {
  LanguageCode,
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
const feedbackReasons = ["I already watched it", "Not interested in this topic", "Too long right now", "I see this too often"];
type Toast = { message: string; tone?: "success" | "info" };

const initialRequest: RecommendationSessionRequest = {
  minutes: 45,
  intent: "learn",
  source: defaultViewerProfile.defaultSource,
  topics: [],
  formats: defaultViewerProfile.formats,
  languages: defaultViewerProfile.languages,
  novelty: defaultViewerProfile.novelty,
  depth: defaultViewerProfile.depth,
  audioFriendly: defaultViewerProfile.audioFriendly,
  antiClickbait: defaultViewerProfile.antiClickbait
};

const initialSignals: ViewerSignalsSummary = {
  mode: "demo",
  connected: false,
  subscriptions: { state: "available", detail: "Connect YouTube to make this signal available." },
  likedVideos: { state: "available", detail: "Connect YouTube to make this signal available." },
  watchHistory: { state: "unavailable", detail: "Not available through the YouTube Data API." },
  watchLater: { state: "unavailable", detail: "Not available through the YouTube Data API." }
};

function Sidebar({ open, active, connected, queueCount, onClose, onNavigate }: {
  open: boolean; active: string; connected: boolean; queueCount: number; onClose: () => void; onNavigate: (id: string) => void;
}) {
  return (
    <>
      <aside className={`viewer-sidebar ${open ? "open" : ""}`} aria-label="Main navigation">
        <div className="viewer-brand"><span className="viewer-brand-mark"><Compass /></span><span>Watchflow</span><button className="icon-button mobile-only" type="button" onClick={onClose} aria-label="Close navigation"><X /></button></div>
        <div className="demo-profile"><span className="profile-avatar"><UserRound /></span><div><strong>Damian's profile</strong><span>Demo taste model</span></div></div>
        <nav>
          <span className="nav-label">Watch</span>
          {navItems.map((item) => { const Icon = item.icon; return <a key={item.id} className={active === item.id ? "active" : ""} href={`#${item.id}`} onClick={() => { onNavigate(item.id); onClose(); }}><Icon /><span>{item.label}</span>{item.id === "queue" && <small>{queueCount}</small>}</a>; })}
          <span className="nav-label secondary-label">Optional tools</span>
          <a href="#creator-tools" onClick={() => { onNavigate("creator-tools"); onClose(); }}><BarChart3 /><span>Creator insights</span><small className="soon">Later</small></a>
        </nav>
        <div className="sidebar-connection"><div><span className={`connection-dot ${connected ? "connected" : ""}`} /><strong>{connected ? "YouTube connected" : "Demo recommendations"}</strong></div><p>{connected ? "Signals are ready for a future live import." : "Connect to personalize with supported YouTube signals."}</p>{!connected && <a className="sidebar-connect" href={`${apiBaseUrl}/api/auth/google`}><Youtube />Connect YouTube</a>}</div>
      </aside>
      <button className={`sidebar-scrim ${open ? "visible" : ""}`} type="button" onClick={onClose} aria-label="Close navigation" />
    </>
  );
}

function RecommendationCard({ video, saved, onSave, onPlay, onReject }: {
  video: ScoredRecommendation; saved: boolean; onSave: () => void; onPlay: () => void; onReject: () => void;
}) {
  return (
    <article className="recommendation-card">
      <div className="video-image-wrap"><img src={video.image} alt="" /><span className="duration-badge">{video.duration}:00</span><span className="match-badge"><Sparkles />{video.match}% match</span><span className={`source-badge ${video.source}`}>{video.source === "subscribed" ? <UserCheck /> : <Telescope />}{video.source === "subscribed" ? "Subscribed" : "New creator"}</span></div>
      <div className="recommendation-copy">
        <div className="video-meta"><span>{video.channel}</span><i /><span>{video.views}</span><i /><span>{video.published}</span></div>
        <h3>{video.title}</h3>
        <div className="signal-row">{video.recommendationSignals.map((signal) => <span key={signal}>{signal}</span>)}</div>
        <div className="why-box"><Lightbulb /><p><strong>Why this fits</strong>{video.reason}</p></div>
        <div className="card-actions"><button className="button primary" type="button" onClick={onPlay}><Play fill="currentColor" />Play demo</button><button className={`icon-button bordered ${saved ? "saved" : ""}`} type="button" onClick={onSave} aria-label={saved ? "Remove from queue" : "Save to queue"}>{saved ? <Check /> : <Bookmark />}</button><button className="icon-button quiet" type="button" onClick={onReject} aria-label="Not for me"><ThumbsDown /></button></div>
      </div>
    </article>
  );
}

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function ViewerDashboard() {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [active, setActive] = React.useState("for-you");
  const [profile, setProfile] = React.useState<ViewerProfile>(defaultViewerProfile);
  const [signals, setSignals] = React.useState<ViewerSignalsSummary>(initialSignals);
  const [connected, setConnected] = React.useState(false);
  const [onboardingOpen, setOnboardingOpen] = React.useState(false);
  const [editingProfile, setEditingProfile] = React.useState(false);
  const [minutes, setMinutes] = React.useState(initialRequest.minutes);
  const [intent, setIntent] = React.useState<WatchIntent>(initialRequest.intent);
  const [source, setSource] = React.useState<SourceMode>(initialRequest.source);
  const [topics, setTopics] = React.useState<string[]>([]);
  const [formats, setFormats] = React.useState<VideoFormat[]>(initialRequest.formats);
  const [languages, setLanguages] = React.useState<LanguageCode[]>(initialRequest.languages);
  const [novelty, setNovelty] = React.useState(initialRequest.novelty);
  const [depth, setDepth] = React.useState(initialRequest.depth);
  const [audioFriendly, setAudioFriendly] = React.useState(initialRequest.audioFriendly);
  const [antiClickbait, setAntiClickbait] = React.useState(initialRequest.antiClickbait);
  const [moreFilters, setMoreFilters] = React.useState(false);
  const [building, setBuilding] = React.useState(false);
  const [session, setSession] = React.useState(() => createDemoSession(initialRequest, defaultViewerProfile));
  const [saved, setSaved] = React.useState(() => new Set(["city-history", "woodworking"]));
  const [feedbackVideo, setFeedbackVideo] = React.useState<ScoredRecommendation | null>(null);
  const [toast, setToast] = React.useState<Toast | null>(null);

  const applyProfileDefaults = React.useCallback((nextProfile: ViewerProfile) => {
    setSource(nextProfile.defaultSource);
    setFormats(nextProfile.formats);
    setLanguages(nextProfile.languages);
    setNovelty(nextProfile.novelty);
    setDepth(nextProfile.depth);
    setAudioFriendly(nextProfile.audioFriendly);
    setAntiClickbait(nextProfile.antiClickbait);
    setTopics([]);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void getViewerProfile().then(async (storedProfile) => {
      if (cancelled) return;
      const params = new URLSearchParams(window.location.search);
      const oauthSuccess = params.get("status") === "success";
      const isConnected = oauthSuccess || getStoredConnection();
      if (oauthSuccess) {
        saveStoredConnection(true);
        const cleanPath = window.location.pathname === "/connected" ? "/" : window.location.pathname;
        window.history.replaceState({}, "", `${cleanPath}${window.location.hash || "#for-you"}`);
      }
      setConnected(isConnected);
      setProfile(storedProfile);
      applyProfileDefaults(storedProfile);
      setSignals(await getViewerSignals(isConnected, storedProfile));
      const request = { ...initialRequest, source: storedProfile.defaultSource, formats: storedProfile.formats, languages: storedProfile.languages, novelty: storedProfile.novelty, depth: storedProfile.depth, audioFriendly: storedProfile.audioFriendly, antiClickbait: storedProfile.antiClickbait };
      setSession(createDemoSession(request, storedProfile));
      if (oauthSuccess && storedProfile.status !== "completed") {
        setEditingProfile(false);
        setOnboardingOpen(true);
      }
    });
    return () => { cancelled = true; };
  }, [applyProfileDefaults]);

  React.useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const buildRequest = React.useCallback((sourceOverride?: SourceMode): RecommendationSessionRequest => ({
    minutes, intent, source: sourceOverride ?? source, topics, formats, languages, novelty, depth, audioFriendly, antiClickbait
  }), [antiClickbait, audioFriendly, depth, formats, intent, languages, minutes, novelty, source, topics]);

  async function generateSession(sourceOverride?: SourceMode) {
    setBuilding(true);
    if (sourceOverride) setSource(sourceOverride);
    const response = await createRecommendationSession(buildRequest(sourceOverride), profile);
    setSession(response);
    setBuilding(false);
    setToast({ message: response.items.length ? "A fresh session is ready. It ends when the last card ends." : "No exact matches yet. Adjust a filter or broaden the source." });
    window.requestAnimationFrame(() => document.querySelector("#discover")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function resetToProfile() {
    applyProfileDefaults(profile);
    setToast({ message: "Session filters reset to your taste profile." });
  }

  function toggleSaved(id: string) {
    setSaved((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    setToast({ message: saved.has(id) ? "Removed from your queue." : "Saved to your queue." });
  }

  const persistProgress = React.useCallback((draft: ViewerProfile) => { void saveViewerProfile(draft); }, []);
  const closeOnboarding = React.useCallback(() => setOnboardingOpen(false), []);
  const completeOnboarding = React.useCallback((draft: ViewerProfile) => {
    void saveViewerProfile(draft).then(async (savedProfile) => {
      setProfile(savedProfile);
      applyProfileDefaults(savedProfile);
      setSignals(await getViewerSignals(connected, savedProfile));
      setOnboardingOpen(false);
      setEditingProfile(false);
      setToast({ message: "Your taste profile is ready and stays fully editable." });
    });
  }, [applyProfileDefaults, connected]);
  const skipOnboarding = React.useCallback((draft: ViewerProfile) => {
    void saveViewerProfile(draft).then(async (savedProfile) => {
      setProfile(savedProfile);
      setSignals(await getViewerSignals(connected, savedProfile));
      setOnboardingOpen(false);
      setToast({ message: "Setup skipped. Demo recommendations will use balanced defaults." });
    });
  }, [connected]);

  const activeFilterLabels = [
    ...topics.map((topic) => interestOptions.find((item) => item.id === topic)?.label ?? topic),
    formats.length < 4 ? formats.map((format) => formatLabels[format]).join(" + ") : "All formats",
    languages.map((language) => languageLabels[language]).join(" + "),
    audioFriendly ? "Audio-friendly" : null,
    antiClickbait ? "Anti-clickbait" : null
  ].filter(Boolean) as string[];

  return (
    <div className="viewer-shell">
      <Sidebar open={menuOpen} active={active} connected={connected} queueCount={saved.size} onClose={() => setMenuOpen(false)} onNavigate={setActive} />
      <div className="mobile-topbar"><button className="icon-button" type="button" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu /></button><span className="viewer-brand compact"><span className="viewer-brand-mark"><Compass /></span>Watchflow</span><a className="mobile-queue" href="#queue" aria-label={`${saved.size} saved videos`}><Bookmark /><small>{saved.size}</small></a></div>

      <main className="viewer-main">
        <header className="viewer-header"><div><span className="eyebrow">Personal discovery</span><h1>Good evening, Damian</h1><p>Let’s find one thing worth your time.</p></div>{connected ? <span className="connected-pill"><CheckCircle2 />YouTube connected</span> : <a className="button secondary connect-button" href={`${apiBaseUrl}/api/auth/google`}><Youtube />Connect YouTube</a>}</header>

        {(profile.status === "skipped" || profile.status === "in_progress") && <aside className="profile-nudge"><Sparkles /><div><strong>Make these recommendations feel more like yours</strong><p>Your taste setup is {profile.status === "in_progress" ? "partly complete" : "using balanced defaults"}. Finish it in about a minute.</p></div><button className="button secondary" type="button" onClick={() => { setEditingProfile(false); setOnboardingOpen(true); }}>Finish setup</button></aside>}

        <section className="intent-panel" id="for-you">
          <div className="intent-heading"><div><span className="section-kicker"><WandSparkles />Build a viewing session</span><h2>What do you want to watch right now?</h2><p>Set the moment. Your taste profile takes care of the rest.</p></div><span className="demo-label"><span />Interactive demo</span></div>

          <div className="composer-layout">
            <fieldset className="control-group"><legend>How much time do you have?</legend><div className="time-options">{[15, 30, 45, 60].map((value) => <button key={value} className={minutes === value ? "selected" : ""} type="button" onClick={() => setMinutes(value)}><Clock3 />{value === 60 ? "60+ min" : `${value} min`}</button>)}</div></fieldset>
            <fieldset className="control-group"><legend>What do you need?</legend><div className="intent-options expanded">{intentOptions.map((option) => <button key={option.value} className={intent === option.value ? "selected" : ""} type="button" onClick={() => setIntent(option.value)}><strong>{option.label}</strong><span>{option.note}</span></button>)}</div></fieldset>
            <fieldset className="control-group"><legend>Where should we look?</legend><div className="source-options">{sourceOptions.map((option) => { const Icon = option.icon; return <button key={option.value} className={source === option.value ? "selected" : ""} type="button" onClick={() => setSource(option.value)}><Icon /><span><strong>{option.label}</strong><small>{option.note}</small></span>{source === option.value && <Check />}</button>; })}</div></fieldset>

            <div className="filters-summary"><div><span>Active filters</span><div>{activeFilterLabels.slice(0, 4).map((label) => <small key={label}>{label}</small>)}{activeFilterLabels.length > 4 && <small>+{activeFilterLabels.length - 4}</small>}</div></div><div><button type="button" onClick={resetToProfile}><RefreshCcw />Reset</button><button type="button" aria-expanded={moreFilters} onClick={() => setMoreFilters((value) => !value)}>More filters<ChevronDown className={moreFilters ? "rotated" : ""} /></button></div></div>

            {moreFilters && <div className="advanced-filters">
              <fieldset><legend>Topic for this session</legend><div className="filter-chip-row">{interestOptions.map((option) => <button key={option.id} className={topics.includes(option.id) ? "selected" : ""} type="button" onClick={() => setTopics((current) => toggleValue(current, option.id))}>{topics.includes(option.id) && <Check />}{option.label}</button>)}</div></fieldset>
              <div className="filter-columns"><fieldset><legend>Formats</legend><div className="filter-chip-row compact">{(Object.keys(formatLabels) as VideoFormat[]).map((format) => <button key={format} className={formats.includes(format) ? "selected" : ""} type="button" onClick={() => setFormats((current) => toggleValue(current, format))}>{formatLabels[format]}</button>)}</div></fieldset><fieldset><legend>Languages</legend><div className="filter-chip-row compact">{(Object.keys(languageLabels) as LanguageCode[]).map((language) => <button key={language} className={languages.includes(language) ? "selected" : ""} type="button" onClick={() => setLanguages((current) => toggleValue(current, language))}>{languageLabels[language]}</button>)}</div></fieldset></div>
              <div className="filter-columns"><label className="range-control"><span><b>Familiar</b><b>Surprise me</b></span><input type="range" min="0" max="100" value={novelty} onChange={(event) => setNovelty(Number(event.target.value))} /><small>{novelty < 40 ? "Mostly familiar" : novelty > 70 ? "More new territory" : "Balanced discovery"}</small></label><label className="range-control"><span><b>Quick overview</b><b>Deep dive</b></span><input type="range" min="0" max="100" value={depth} onChange={(event) => setDepth(Number(event.target.value))} /><small>{depth < 40 ? "Light and quick" : depth > 70 ? "Detailed and focused" : "Useful detail"}</small></label></div>
              <div className="filter-columns toggles"><label className="toggle-row"><span><Brain /><span><strong>Audio-friendly</strong><small>Works without watching closely</small></span></span><input type="checkbox" checked={audioFriendly} onChange={(event) => setAudioFriendly(event.target.checked)} /><i /></label><label className="toggle-row"><span><CheckCircle2 /><span><strong>Anti-clickbait filter</strong><small>Prefer accurate titles</small></span></span><input type="checkbox" checked={antiClickbait} onChange={(event) => setAntiClickbait(event.target.checked)} /><i /></label></div>
            </div>}
            <button className="button primary build-button" type="button" onClick={() => void generateSession()} disabled={building || !formats.length || !languages.length}>{building ? <LoaderCircle className="spin" /> : <Sparkles />}{building ? "Building your session…" : "Build my session"}</button>
          </div>
        </section>

        <section className="session-section" id="discover">
          <div className="section-header"><div><span className="section-kicker">Made for this moment</span><h2>{session.items.length ? `Your ${session.totalMinutes}-minute session` : "No exact matches yet"}</h2><p>{session.items.length ? `${session.items.length} focused picks, ordered to flow naturally.` : "Your filters are working. Try a broader source or remove one filter."}</p></div>{session.items.length > 0 && <div className="session-stop"><Check /><span><strong>Natural stopping point</strong>No endless feed after video {session.items.length}</span></div>}</div>
          {session.items.length ? <><div className="session-timeline" aria-label={`${session.items.length} video session lasting ${session.totalMinutes} minutes`}>{session.items.map((video, index) => <span key={video.id} style={{ flex: video.duration }}><i>{index + 1}</i>{video.duration} min</span>)}<b>Done</b></div><div className="recommendation-grid">{session.items.map((video) => <RecommendationCard key={video.id} video={video} saved={saved.has(video.id)} onSave={() => toggleSaved(video.id)} onPlay={() => setToast({ message: `Demo player: “${video.title}” is ready to open on YouTube.`, tone: "info" })} onReject={() => setFeedbackVideo(video)} />)}</div></> : <div className="recommendation-empty"><Search /><strong>Nothing fits every choice</strong><p>We will never silently mix in a source you did not choose.</p>{source !== "mixed" && <button className="button secondary" type="button" onClick={() => void generateSession("mixed")}><Users />Try Balanced instead</button>}</div>}
        </section>

        <div className="utility-grid"><section className="utility-panel queue-panel" id="queue"><div className="section-header compact-header"><div><span className="section-kicker">Saved-video rescue</span><h2>Worth another look</h2><p>Demo examples of videos that have been waiting too long.</p></div><button className="button secondary" type="button" onClick={() => setToast({ message: `Tonight's pick: “${queueItems[1].title}”.`, tone: "info" })}><Sparkles />Pick one</button></div><div className="queue-list">{queueItems.map((video, index) => <article key={video.id}><img src={video.image} alt="" /><div><span>{index === 0 ? "Saved 3 weeks ago" : index === 1 ? "Saved 1 month ago" : "Saved 6 weeks ago"}</span><h3>{video.title}</h3><p>{video.channel} · {video.duration} min</p></div><button className="icon-button" type="button" onClick={() => setToast({ message: `Queued “${video.title}” as your next video.` })} aria-label={`Choose ${video.title}`}><ChevronRight /></button></article>)}</div></section>
          <section className="utility-panel path-panel" id="paths"><div className="section-header compact-header"><div><span className="section-kicker">Continue learning</span><h2>Understanding the night sky</h2><p>1 of 4 steps completed</p></div><span className="path-progress">25%</span></div><div className="path-steps"><div className="complete"><span><Check /></span><div><strong>How to read the night sky</strong><small>Completed · 12 min</small></div></div><div className="current"><span>2</span><div><strong>Why Saturn has rings</strong><small>Up next · 18 min</small></div><Play /></div><div><span>3</span><div><strong>Finding planets from home</strong><small>15 min</small></div></div><div><span>4</span><div><strong>Your first telescope</strong><small>21 min</small></div></div></div></section></div>

        <div className="utility-grid bottom-grid" id="taste"><section className="utility-panel taste-panel profile-summary"><div className="section-header compact-header"><div><span className="section-kicker">Editable taste profile</span><h2>What Watchflow understands</h2><p>{profile.status === "completed" ? "Your saved defaults guide every new session." : "Balanced demo defaults are active until setup is complete."}</p></div><Brain /></div><div className="profile-summary-grid"><div><span>Interests</span><p>{profile.interests.map((interest) => interestOptions.find((item) => item.id === interest)?.label ?? interest).join(", ") || "Not set"}</p></div><div><span>Languages</span><p>{profile.languages.map((language) => languageLabels[language]).join(", ")}</p></div><div><span>Default source</span><p>{sourceOptions.find((option) => option.value === profile.defaultSource)?.label}</p></div><div><span>YouTube signals</span><p>{profile.useSubscriptions && profile.useLikedVideos ? "Subscriptions + likes" : profile.useSubscriptions ? "Subscriptions" : profile.useLikedVideos ? "Liked videos" : "Explicit profile only"}</p></div></div><button className="button secondary edit-profile" type="button" onClick={() => { setEditingProfile(true); setOnboardingOpen(true); }}><SlidersHorizontal />Edit taste profile</button></section>
          <section className="utility-panel diet-panel"><div className="section-header compact-header"><div><span className="section-kicker">This week's content diet</span><h2>Balanced, with room to explore</h2><p>Demo visualization based on example activity.</p></div></div><div className="diet-bars"><div><span><b>Learning</b><small>42%</small></span><i><b style={{ width: "42%" }} /></i></div><div><span><b>Relaxation</b><small>28%</small></span><i><b style={{ width: "28%" }} /></i></div><div><span><b>Practical</b><small>19%</small></span><i><b style={{ width: "19%" }} /></i></div><div><span><b>New perspectives</b><small>11%</small></span><i><b style={{ width: "11%" }} /></i></div></div><p className="diet-note"><Lightbulb />This is demo data. Live activity tracking is not implemented.</p></section></div>
        <section className="creator-note" id="creator-tools"><BarChart3 /><div><strong>Creator analytics stays optional</strong><p>Channel performance tools can live here later, without distracting from the viewer-first experience.</p></div><span>Future add-on</span></section>
      </main>

      <OnboardingModal open={onboardingOpen} profile={profile} signals={signals} editing={editingProfile} onProgress={persistProgress} onComplete={completeOnboarding} onSkip={skipOnboarding} onClose={closeOnboarding} />
      {feedbackVideo && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setFeedbackVideo(null); }}><div className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title"><button className="icon-button dialog-close" type="button" onClick={() => setFeedbackVideo(null)} aria-label="Close"><X /></button><span className="feedback-icon"><ThumbsDown /></span><h2 id="feedback-title">Help us tune your recommendations</h2><p>Why isn't “{feedbackVideo.title}” right for you?</p><div>{feedbackReasons.map((reason) => <button key={reason} type="button" onClick={() => { setSession((current) => ({ ...current, items: current.items.filter((video) => video.id !== feedbackVideo.id), totalMinutes: current.totalMinutes - feedbackVideo.duration })); setFeedbackVideo(null); setToast({ message: `Got it: ${reason.toLowerCase()}.` }); }}>{reason}<ChevronRight /></button>)}</div></div></div>}
      {toast && <div className={`toast ${toast.tone ?? "success"}`} role="status"><span className="status-dot" />{toast.message}</div>}
    </div>
  );
}
