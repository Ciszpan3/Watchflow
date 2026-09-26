import { ProfileStatus } from "../generated/prisma/enums.js";
import type { ViewerProfile } from "../generated/prisma/client.js";
import { db } from "../db.js";
import { defaultProfile, type ViewerProfileInput } from "./contracts.js";

const toDatabaseStatus: Record<ViewerProfileInput["status"], ProfileStatus> = {
  not_started: ProfileStatus.NOT_STARTED,
  in_progress: ProfileStatus.IN_PROGRESS,
  completed: ProfileStatus.COMPLETED,
  skipped: ProfileStatus.SKIPPED
};

const fromDatabaseStatus: Record<ProfileStatus, ViewerProfileInput["status"]> = {
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  SKIPPED: "skipped"
};

export function profileCreateData(profile: ViewerProfileInput = defaultProfile) {
  return {
    version: 2,
    status: toDatabaseStatus[profile.status],
    interests: profile.interests,
    customTopics: profile.customTopics,
    excludedTopics: profile.excludedTopics,
    languages: profile.languages,
    formats: profile.formats,
    defaultSource: profile.defaultSource,
    audioFriendly: profile.audioFriendly,
    antiClickbait: profile.antiClickbait,
    useSubscriptions: profile.useSubscriptions,
    useLikedVideos: profile.useLikedVideos
  };
}

export function serializeProfile(profile: ViewerProfile): ViewerProfileInput {
  return {
    version: 2,
    status: fromDatabaseStatus[profile.status],
    interests: profile.interests,
    customTopics: profile.customTopics,
    excludedTopics: profile.excludedTopics,
    languages: profile.languages.filter((item): item is "en" | "pl" => item === "en" || item === "pl"),
    formats: profile.formats.filter((item): item is "standard" | "short" | "live" | "podcast" => ["standard", "short", "live", "podcast"].includes(item)),
    defaultSource: profile.defaultSource === "subscribed" || profile.defaultSource === "new" ? profile.defaultSource : "mixed",
    audioFriendly: profile.audioFriendly,
    antiClickbait: profile.antiClickbait,
    useSubscriptions: profile.useSubscriptions,
    useLikedVideos: profile.useLikedVideos
  };
}

export async function getOrCreateProfile(userId: string) {
  return db.viewerProfile.upsert({
    where: { userId },
    update: {},
    create: { userId, ...profileCreateData() }
  });
}
