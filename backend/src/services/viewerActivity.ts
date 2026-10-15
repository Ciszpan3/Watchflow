type DietVideo = {
  channelId: string;
  durationSeconds: number;
  intents: string[];
  topics: string[];
};

export type DietEntry = {
  watchedAt: Date;
  video: DietVideo;
};

const categoryByIntent: Record<string, { key: string; label: string }> = {
  learn: { key: "learning", label: "Learning" },
  relax: { key: "relaxation", label: "Relaxation" },
  inspire: { key: "inspiration", label: "Inspiration" },
  company: { key: "company", label: "Company" },
  solve: { key: "practical", label: "Practical" },
  entertain: { key: "entertainment", label: "Entertainment" }
};

export function buildContentDiet(entries: DietEntry[], subscribedChannelIds: Set<string>, now = new Date(), periodDays = 7) {
  const periodStart = new Date(now.getTime() - periodDays * 86_400_000);
  const recent = entries.filter((entry) => entry.watchedAt >= periodStart && entry.watchedAt <= now);
  const categoryCounts = new Map<string, { label: string; count: number }>();
  const topicCounts = new Map<string, number>();
  let subscribed = 0;

  for (const entry of recent) {
    const category = categoryByIntent[entry.video.intents[0] ?? ""] ?? categoryByIntent.entertain;
    const current = categoryCounts.get(category.key) ?? { label: category.label, count: 0 };
    current.count += 1;
    categoryCounts.set(category.key, current);
    for (const topic of new Set(entry.video.topics)) topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    if (subscribedChannelIds.has(entry.video.channelId)) subscribed += 1;
  }

  const categories = [...categoryCounts.entries()]
    .map(([key, value]) => ({
      key,
      label: value.label,
      count: value.count,
      percentage: recent.length ? Math.round((value.count / recent.length) * 100) : 0
    }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const topTopics = [...topicCounts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((left, right) => right.count - left.count || left.topic.localeCompare(right.topic))
    .slice(0, 4);

  return {
    periodDays,
    periodStart: periodStart.toISOString(),
    watchedCount: recent.length,
    totalMinutes: recent.reduce((sum, entry) => sum + Math.max(1, Math.ceil(entry.video.durationSeconds / 60)), 0),
    uniqueChannels: new Set(recent.map((entry) => entry.video.channelId)).size,
    categories,
    topTopics,
    sources: { subscribed, new: recent.length - subscribed }
  };
}
