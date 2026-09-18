import type { youtube_v3 } from "googleapis";
import { parseIsoDurationToSeconds } from "./youtube.js";

const topicKeywords: Record<string, string[]> = {
  technology: ["technology", "tech", "software", "coding", "programming", "ai", "computer", "gadgets"],
  science: ["science", "space", "physics", "biology", "astronomy", "chemistry", "ocean"],
  history: ["history", "historical", "ancient", "war", "century", "archaeology"],
  cooking: ["cooking", "recipe", "food", "kitchen", "bake", "ramen"],
  design: ["design", "architecture", "interior", "typography", "creative"],
  finance: ["finance", "money", "investing", "investment", "etf", "stock", "budget"],
  health: ["health", "fitness", "workout", "mobility", "nutrition", "wellness"],
  gaming: ["gaming", "game", "games", "playstation", "xbox", "nintendo"],
  music: ["music", "song", "album", "piano", "guitar", "concert"],
  culture: ["culture", "society", "film", "cinema", "book", "philosophy"],
  travel: ["travel", "city", "country", "trip", "guide", "prague"],
  diy: ["diy", "build", "woodworking", "repair", "tools", "craft"]
};

function textFor(item: youtube_v3.Schema$Video) {
  return [item.snippet?.title, item.snippet?.description, ...(item.snippet?.tags ?? [])].join(" ").toLowerCase();
}

export function classifyVideo(item: youtube_v3.Schema$Video) {
  const text = textFor(item);
  const durationSeconds = parseIsoDurationToSeconds(item.contentDetails?.duration ?? "PT0S");
  const live = item.snippet?.liveBroadcastContent && item.snippet.liveBroadcastContent !== "none";
  const podcastWords = ["podcast", "interview", "conversation", "talk", "rozmowa", "wywiad"];
  const format = live ? "live" : durationSeconds <= 180 ? "short" : durationSeconds >= 1200 && podcastWords.some((word) => text.includes(word)) ? "podcast" : "standard";
  const topics = Object.entries(topicKeywords)
    .filter(([, words]) => words.some((word) => text.includes(word)))
    .map(([topic]) => topic);
  const intents = new Set<string>();
  if (/how to|tutorial|guide|explained|jak |poradnik|dlaczego/.test(text)) intents.add("learn");
  if (/how to|fix|solve|recipe|workout|tutorial|poradnik/.test(text)) intents.add("solve");
  if (/music|ambient|relax|calm|quiet|slow/.test(text)) intents.add("relax");
  if (format === "podcast" || format === "live") intents.add("company");
  if (/idea|design|creative|story|inspir/.test(text)) intents.add("inspire");
  if (!intents.size || /funny|game|entertain|challenge|music/.test(text)) intents.add("entertain");
  const language = item.snippet?.defaultAudioLanguage?.slice(0, 2)
    ?? item.snippet?.defaultLanguage?.slice(0, 2)
    ?? (/[ąćęłńóśźż]/i.test(item.snippet?.title ?? "") ? "pl" : "en");
  const clickbaitScore = [/[!?]{2,}/, /\b(shocking|unbelievable|you won't believe|musisz to zobaczyć)\b/i, /[A-Z]{8,}/]
    .reduce((score, pattern) => score + (pattern.test(item.snippet?.title ?? "") ? 34 : 0), 0);
  const audioFriendly = format === "podcast" || /podcast|interview|conversation|audio|listen|rozmowa|wywiad/i.test(text);

  return {
    durationSeconds,
    format,
    topics: topics.length ? topics : ["culture"],
    intents: [...intents],
    language: language === "pl" ? "pl" : "en",
    clickbaitScore: Math.min(100, clickbaitScore),
    audioFriendly
  };
}
