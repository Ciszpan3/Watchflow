import type { youtube_v3 } from "googleapis";
import { parseIsoDurationToSeconds } from "./youtube.js";

const topicKeywords: Record<string, string[]> = {
  technology: ["technology", "tech", "software", "coding", "programming", "artificial intelligence", "computer", "gadgets", "cybersecurity", "robotics"],
  science: ["science", "space", "physics", "biology", "astronomy", "chemistry", "scientist", "research", "oceanography"],
  history: ["history", "historical", "ancient", "medieval", "archaeology", "civilization", "world war", "cold war"],
  cooking: ["cooking", "recipe", "kitchen", "baking", "chef", "meal prep", "cuisine"],
  design: ["design", "architecture", "interior design", "typography", "graphic design", "industrial design", "ux design"],
  finance: ["finance", "personal finance", "investing", "investment", "etf", "stock market", "budgeting", "financial freedom"],
  health: [
    "health", "fitness", "workout", "mobility", "nutrition", "wellness", "bodybuilding", "body building",
    "body transformation", "fitness journey", "transformation", "weight loss", "weight-loss", "fat loss", "exercise", "gym",
    "training", "physique", "diet", "calories", "strength", "cardio", "muscle", "metabolism",
    "zdrowie", "fitness", "trening", "siłownia", "sylwetka", "odchudzanie", "redukcja", "mięśnie", "metamorfoza", "przemiana"
  ],
  gaming: ["gaming", "gameplay", "video game", "video games", "playstation", "xbox", "nintendo", "pc gaming", "steam", "esports"],
  music: ["music", "song", "album", "piano", "guitar", "concert", "music video"],
  culture: ["culture", "society", "cinema", "literature", "philosophy", "cultural history", "art history"],
  travel: [
    "travel", "travelling", "traveling", "tourism", "tourist", "travel vlog", "travel guide", "solo travel",
    "backpacking", "road trip", "city break", "itinerary", "destination", "vacation", "places to visit"
  ],
  diy: ["diy", "do it yourself", "woodworking", "home repair", "restoration", "craft tutorial"]
};

const categoryTopics: Record<string, string[]> = {
  "19": ["travel"],
  "20": ["gaming"],
  "10": ["music"]
};

export function classifyTopicsFromText(value: string) {
  const text = value.toLowerCase();
  return Object.entries(topicKeywords)
    .filter(([, words]) => words.some((word) => containsKeyword(text, word)))
    .map(([topic]) => topic);
}

export function topicSearchTerms(topic: string) {
  return topicKeywords[topic] ?? [topic];
}

export function classifyStoredVideoTopics(video: {
  title: string;
  description?: string | null;
  tags?: string[];
  categoryId?: string | null;
  channelTitle?: string | null;
  channelDescription?: string | null;
  topics?: string[];
}) {
  const text = [
    video.title,
    video.description ?? "",
    ...(video.tags ?? []),
    video.channelTitle ?? "",
    video.channelDescription ?? ""
  ].join(" ");
  return [...new Set([
    ...(video.topics ?? []),
    ...classifyTopicsFromText(text),
    ...(video.categoryId ? categoryTopics[video.categoryId] ?? [] : [])
  ])];
}

function containsKeyword(text: string, keyword: string) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:$|[^\\p{L}\\p{N}])`, "iu").test(text);
}

function textFor(item: youtube_v3.Schema$Video) {
  return [item.snippet?.title, item.snippet?.description, ...(item.snippet?.tags ?? [])].join(" ").toLowerCase();
}

export function classifyLanguage(title: string, declaredLanguage?: string | null) {
  const declared = declaredLanguage?.slice(0, 2).toLowerCase();
  if (declared) return declared;
  const normalized = title.toLowerCase();
  if (/[ąćęłńóśźż]/i.test(title)) return "pl";
  if (/\b(tôi|chơi|thử|bản|kinh|dị|quên|của|không|một)\b/iu.test(normalized) || /[ăđơư]/iu.test(title)) return "vi";
  if (/\b(der|die|das|ist|wenn|für|nicht|eine|einen|stimmt|völlig)\b/iu.test(normalized) || /[äöüß]/iu.test(title)) return "de";
  if (/\b(el|los|las|una|para|como|juego|jugando|español)\b/iu.test(normalized) || /[¿¡]/u.test(title)) return "es";
  if (/\b(um|uma|não|você|jogo|jogando|português)\b/iu.test(normalized) || /[ãõ]/iu.test(title)) return "pt";
  if (/\p{Script=Cyrillic}/u.test(title)) return "ru";
  return "en";
}

export function classifyVideo(item: youtube_v3.Schema$Video) {
  const text = textFor(item);
  const durationSeconds = parseIsoDurationToSeconds(item.contentDetails?.duration ?? "PT0S");
  const live = item.snippet?.liveBroadcastContent && item.snippet.liveBroadcastContent !== "none";
  const podcastWords = ["podcast", "interview", "conversation", "talk", "rozmowa", "wywiad"];
  const format = live ? "live" : durationSeconds <= 180 ? "short" : durationSeconds >= 1200 && podcastWords.some((word) => text.includes(word)) ? "podcast" : "standard";
  const topics = [...new Set([
    ...classifyTopicsFromText(text),
    ...(item.snippet?.categoryId ? categoryTopics[item.snippet.categoryId] ?? [] : [])
  ])];
  const intents = new Set<string>();
  if (/how to|tutorial|guide|explained|jak |poradnik|dlaczego/.test(text)) intents.add("learn");
  if (/how to|fix|solve|recipe|workout|tutorial|poradnik/.test(text)) intents.add("solve");
  if (/music|ambient|relax|calm|quiet|slow/.test(text)) intents.add("relax");
  if (format === "podcast" || format === "live") intents.add("company");
  if (/idea|design|creative|story|inspir/.test(text)) intents.add("inspire");
  if (!intents.size || /funny|game|entertain|challenge|music/.test(text)) intents.add("entertain");
  const language = classifyLanguage(
    item.snippet?.title ?? "",
    item.snippet?.defaultAudioLanguage ?? item.snippet?.defaultLanguage
  );
  const clickbaitScore = [/[!?]{2,}/, /\b(shocking|unbelievable|you won't believe|musisz to zobaczyć)\b/i, /[A-Z]{8,}/]
    .reduce((score, pattern) => score + (pattern.test(item.snippet?.title ?? "") ? 34 : 0), 0);
  const audioFriendly = format === "podcast" || /podcast|interview|conversation|audio|listen|rozmowa|wywiad/i.test(text);

  return {
    durationSeconds,
    format,
    topics: topics.length ? topics : ["culture"],
    intents: [...intents],
    language,
    clickbaitScore: Math.min(100, clickbaitScore),
    audioFriendly
  };
}
