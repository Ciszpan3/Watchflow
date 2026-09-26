import type {
  FitTier,
  QueueItem,
  Recommendation,
  RecommendationSessionRequest,
  RecommendationSessionResponse,
  ScoredRecommendation,
  SourceMode,
  ViewerProfile
} from "./viewerTypes";

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

export function fitTier(score: number): FitTier {
  return score >= 75 ? "excellent" : score >= 60 ? "strong" : score >= 45 ? "good" : "exploratory";
}

export const interestOptions = [
  { id: "technology", label: "Technology" },
  { id: "science", label: "Science" },
  { id: "history", label: "History" },
  { id: "cooking", label: "Cooking" },
  { id: "design", label: "Design" },
  { id: "finance", label: "Finance" },
  { id: "health", label: "Health & fitness" },
  { id: "gaming", label: "Gaming" },
  { id: "music", label: "Music" },
  { id: "culture", label: "Culture" },
  { id: "travel", label: "Travel" },
  { id: "diy", label: "DIY" }
] as const;

const demoRecommendations: Array<Omit<Recommendation, "publishedAt"> & { novelty: number; depth: number }> = [
  {
    id: "ocean", title: "The Hidden Cities Beneath the Ocean", channel: "Deep Atlas",
    image: "/recommendations/deep-ocean.png", duration: 14, views: "1.8M views", published: "2 weeks ago",
    intents: ["learn", "relax"], source: "subscribed", channelSubscribed: true, topics: ["science"], language: "en", format: "standard",
    likedAffinity: 92, novelty: 45, depth: 66, baseReason: "A calm science story from a channel you already trust.", signals: ["Subscribed", "Science", "Calm pacing"]
  },
  {
    id: "ramen", title: "A Better Bowl of Ramen in 20 Minutes", channel: "Everyday Table",
    image: "/recommendations/ramen.png", duration: 11, views: "684K views", published: "5 days ago",
    intents: ["learn", "solve", "company"], source: "new", channelSubscribed: false, topics: ["cooking"], language: "en", format: "standard",
    likedAffinity: 76, novelty: 78, depth: 36, baseReason: "A concise practical recipe from a creator outside your subscriptions.", signals: ["New creator", "Practical", "Fast payoff"]
  },
  {
    id: "saturn", title: "Why Saturn's Rings Are Disappearing", channel: "Night Sky Lab",
    image: "/recommendations/saturn.png", duration: 18, views: "2.3M views", published: "1 month ago",
    intents: ["learn", "inspire"], source: "subscribed", channelSubscribed: true, topics: ["science"], language: "en", format: "standard",
    likedAffinity: 88, novelty: 42, depth: 84, baseReason: "A deeper follow-up to the astronomy videos you tend to like.", signals: ["Subscribed", "Liked-video fit", "Deep dive"]
  },
  {
    id: "tiny-home", title: "Inside a 32 m² Home That Feels Twice as Big", channel: "Living Small",
    image: "/recommendations/tiny-home.png", duration: 13, views: "932K views", published: "8 days ago",
    intents: ["relax", "inspire", "entertain"], source: "new", channelSubscribed: false, topics: ["design"], language: "en", format: "standard",
    likedAffinity: 72, novelty: 70, depth: 42, baseReason: "A visual, low-effort design watch from a new perspective.", signals: ["New creator", "Design", "Easy watch"]
  },
  {
    id: "city-history", title: "How One Street Changed Over 100 Years", channel: "Past / Present",
    image: "/recommendations/city-history.png", duration: 16, views: "417K views", published: "3 weeks ago",
    intents: ["learn", "relax"], source: "subscribed", channelSubscribed: true, topics: ["history", "culture"], language: "en", format: "standard",
    likedAffinity: 81, novelty: 38, depth: 68, baseReason: "History and urban design overlap with two of your saved interests.", signals: ["Subscribed", "History", "Story-led"]
  },
  {
    id: "woodworking", title: "Building a Walnut Table With Only Hand Tools", channel: "Quiet Workshop",
    image: "/recommendations/woodworking.png", duration: 12, views: "286K views", published: "4 days ago",
    intents: ["relax", "inspire", "company"], source: "new", channelSubscribed: false, topics: ["diy", "design"], language: "en", format: "standard",
    likedAffinity: 64, novelty: 84, depth: 29, baseReason: "Minimal talking and a satisfying process make this an easy background watch.", signals: ["New creator", "Craft", "Audio-light"]
  },
  {
    id: "tech-podcast", title: "What AI Will Actually Change This Year", channel: "Useful Futures",
    image: "/thumbnails/ai-workflow.png", duration: 24, views: "348K views", published: "Yesterday",
    intents: ["learn", "company", "inspire"], source: "subscribed", channelSubscribed: true, topics: ["technology"], language: "en", format: "podcast",
    likedAffinity: 86, novelty: 44, depth: 75, baseReason: "A measured conversation from a subscribed technology channel.", signals: ["Subscribed", "Podcast", "Technology"]
  },
  {
    id: "finance-pl", title: "ETF-y bez żargonu: spokojny start", channel: "Proste Finanse",
    image: "/recommendations/city-history.png", duration: 10, views: "191K views", published: "6 days ago",
    intents: ["learn", "solve"], source: "new", channelSubscribed: false, topics: ["finance"], language: "pl", format: "standard",
    likedAffinity: 58, novelty: 88, depth: 48, baseReason: "A clear Polish introduction from a channel you have not seen before.", signals: ["Nowy twórca", "Polski", "Praktyczne"]
  },
  {
    id: "travel-short", title: "Three Quiet Corners of Prague", channel: "Slow Weekend",
    image: "/recommendations/city-history.png", duration: 5, views: "1.1M views", published: "3 days ago",
    intents: ["relax", "entertain", "inspire"], source: "new", channelSubscribed: false, topics: ["travel", "culture"], language: "en", format: "short",
    likedAffinity: 52, novelty: 91, depth: 18, baseReason: "A compact visual detour that fits a short break.", signals: ["New creator", "Short", "Travel"]
  },
  {
    id: "health-live", title: "Live Mobility Session for Desk Workers", channel: "Move Better",
    image: "/recommendations/tiny-home.png", duration: 20, views: "54K views", published: "Live today",
    intents: ["solve", "company"], source: "subscribed", channelSubscribed: true, topics: ["health"], language: "en", format: "live",
    likedAffinity: 69, novelty: 35, depth: 40, baseReason: "A practical live session from a health channel in your subscriptions.", signals: ["Subscribed", "Live", "Practical"]
  },
  {
    id: "gaming-pl", title: "Dlaczego gry uczą nas podejmowania decyzji", channel: "Poziom Wyżej",
    image: "/thumbnails/first-30-seconds.png", duration: 9, views: "278K views", published: "1 week ago",
    intents: ["entertain", "learn"], source: "subscribed", channelSubscribed: true, topics: ["gaming", "culture"], language: "pl", format: "standard",
    likedAffinity: 74, novelty: 40, depth: 46, baseReason: "A Polish essay connecting games with a broader cultural idea.", signals: ["Subskrypcja", "Polski", "Gaming"]
  },
  {
    id: "music-live", title: "A Live Session Built From One Piano Loop", channel: "Room Tone",
    image: "/recommendations/woodworking.png", duration: 15, views: "83K views", published: "2 days ago",
    intents: ["relax", "company", "entertain"], source: "new", channelSubscribed: false, topics: ["music"], language: "en", format: "live",
    likedAffinity: 49, novelty: 95, depth: 22, baseReason: "A low-pressure live performance from outside your usual channels.", signals: ["New creator", "Live", "Music"]
  }
];

export const recommendations: Recommendation[] = demoRecommendations.map(({ novelty: _novelty, depth: _depth, ...video }, index) => ({
  ...video,
  publishedAt: daysAgo([14, 5, 30, 8, 21, 4, 1, 6, 3, 0, 7, 2][index])
}));

export const queueItems: QueueItem[] = recommendations.slice(3, 6).map((video, index) => ({
  ...video,
  fit: "good",
  reason: video.baseReason,
  recommendationSignals: video.signals.slice(0, 3),
  savedAt: daysAgo([21, 30, 42][index])
}));

function overlap(left: string[], right: string[]) {
  return left.filter((value) => right.includes(value));
}

function scoreVideo(video: Recommendation, request: RecommendationSessionRequest, profile: ViewerProfile) {
  const requestedTopics = request.topics.length ? request.topics : [...profile.interests, ...profile.customTopics];
  const topicMatches = overlap(video.topics, requestedTopics);
  const intentScore = video.intents.includes(request.intent) ? 30 : 0;
  const topicScore = topicMatches.length ? 25 : 0;
  const affinityScore = profile.useLikedVideos ? video.likedAffinity * 0.2 : 10;
  const tolerance = Math.max(5, Math.ceil(request.minutes * 0.2));
  const distance = Math.abs(video.duration - request.minutes);
  const durationScore = !request.timeLimitEnabled ? 0 : request.recommendationMode === "single"
    ? distance <= tolerance ? 15 - (distance / tolerance) * 5 : Math.max(0, 10 - (distance - tolerance))
    : Math.max(0, 15 - Math.max(0, video.duration - request.minutes) * 2);
  const ageDays = video.publishedAt ? Math.max(0, (Date.now() - new Date(video.publishedAt).getTime()) / 86_400_000) : Number.POSITIVE_INFINITY;
  const freshnessPenalty = ageDays <= 30 ? 0 : ageDays <= 183 ? 2 : ageDays <= 365 ? 5 : ageDays <= 730 ? 10 : 18;
  return {
    value: Math.max(0, Math.min(90, Math.round(intentScore + topicScore + affinityScore + durationScore - freshnessPenalty))),
    topicMatches
  };
}

function sourceAllowed(video: Recommendation, source: SourceMode) {
  return source === "mixed" || video.source === source;
}

type RankedRecommendation = ScoredRecommendation & { score: number };

function diversify(candidates: RankedRecommendation[], selected: RankedRecommendation[]) {
  return [...candidates].sort((left, right) => {
    const penalty = (video: RankedRecommendation) => selected.reduce((total, picked) => {
      const sameChannel = video.channel === picked.channel ? 18 : 0;
      const sameTopic = overlap(video.topics, picked.topics).length ? 8 : 0;
      return total + sameChannel + sameTopic;
    }, 0);
    return (right.score - penalty(right)) - (left.score - penalty(left));
  });
}

function enrich(video: Recommendation, request: RecommendationSessionRequest, profile: ViewerProfile): RankedRecommendation {
  const scored = scoreVideo(video, request, profile);
  const sourceSignal = video.source === "subscribed" ? "From your subscriptions" : "New creator discovery";
  const affinitySignal = profile.useLikedVideos && video.likedAffinity >= 70 ? "Strong liked-video fit" : null;
  const topicSignal = scored.topicMatches[0] ? `Matches your ${scored.topicMatches[0]} interest` : video.intents.includes(request.intent) ? `Fits ${request.intent}` : null;
  return {
    ...video,
    score: scored.value,
    fit: fitTier(scored.value),
    reason: `${video.baseReason} ${sourceSignal}.`,
    recommendationSignals: [sourceSignal, affinitySignal, topicSignal].filter((signal): signal is string => Boolean(signal)).slice(0, 3)
  };
}

function withinSelectedAge(video: Recommendation, maxAgeMonths: RecommendationSessionRequest["maxAgeMonths"]) {
  if (maxAgeMonths === null) return true;
  if (!video.publishedAt) return false;
  const cutoff = new Date();
  cutoff.setUTCMonth(cutoff.getUTCMonth() - maxAgeMonths);
  return new Date(video.publishedAt) >= cutoff;
}

export function createDemoSession(
  request: RecommendationSessionRequest,
  profile: ViewerProfile,
  videos = recommendations,
  excludedVideoIds: string[] = [],
  page = 1,
  chainId = `demo-chain-${Date.now()}`
): RecommendationSessionResponse {
  const excluded = [...profile.excludedTopics];
  const excludedIds = new Set(excludedVideoIds);
  const sourceCandidates = videos.filter((video) => sourceAllowed(video, request.source) && !excludedIds.has(video.id));
  const filtered = sourceCandidates.filter((video) => {
    const matchesTopic = request.topics.length === 0 || overlap(video.topics, request.topics).length > 0;
    const allowedTopic = overlap(video.topics, excluded).length === 0;
    return matchesTopic
      && allowedTopic
      && withinSelectedAge(video, request.maxAgeMonths)
      && request.languages.includes(video.language)
      && request.formats.includes(video.format);
  });

  if (!filtered.length) {
    return {
      mode: "demo", sessionId: `demo-${Date.now()}`, chainId, totalMinutes: 0,
      naturalEnd: request.recommendationMode === "session", request, page, hasMore: false,
      recommendationMode: request.recommendationMode, seenVideoIds: excludedVideoIds, items: [],
      emptyReason: sourceCandidates.length ? "no_filter_matches" : "no_source_matches"
    };
  }

  const ranked = filtered
    .map((video) => enrich(video, request, profile))
    .sort((left, right) => request.recommendationMode === "single" && request.timeLimitEnabled
      ? Math.abs(left.duration - request.minutes) - Math.abs(right.duration - request.minutes) || right.score - left.score
      : right.score - left.score);
  const pools = {
    subscribed: ranked.filter((video) => video.source === "subscribed"),
    new: ranked.filter((video) => video.source === "new")
  };
  const count = request.recommendationMode === "single" ? 5 : 3;
  const preferredSources: Array<"subscribed" | "new"> = request.source === "mixed"
    ? Array.from({ length: count }, (_, index) => index % 2 === 0 ? "subscribed" : "new")
    : Array.from({ length: count }, () => request.source as "subscribed" | "new");

  const selected: RankedRecommendation[] = [];
  let totalMinutes = 0;
  for (const preferredSource of preferredSources) {
    const desiredPool = diversify(pools[preferredSource], selected);
    const fallbackPool = request.source === "mixed"
      ? diversify(pools[preferredSource === "subscribed" ? "new" : "subscribed"], selected)
      : [];
    const next = [...desiredPool, ...fallbackPool].find((video) =>
      !selected.some((item) => item.id === video.id)
      && (request.recommendationMode === "single" || !request.timeLimitEnabled || totalMinutes + video.duration <= request.minutes)
    );
    if (!next) continue;
    selected.push(next);
    totalMinutes += next.duration;
  }

  return {
    mode: "demo",
    sessionId: `demo-${Date.now()}`,
    chainId,
    totalMinutes,
    naturalEnd: request.recommendationMode === "session",
    request,
    page,
    hasMore: ranked.some((video) => !selected.some((item) => item.id === video.id)),
    recommendationMode: request.recommendationMode,
    seenVideoIds: [...excludedVideoIds, ...selected.map((item) => item.id)],
    items: selected.map(({ score: _score, ...video }) => video),
    emptyReason: selected.length ? undefined : "no_filter_matches"
  };
}

export function sessionDuration(videos: Array<{ duration: number }>) {
  return videos.reduce((total, video) => total + video.duration, 0);
}
