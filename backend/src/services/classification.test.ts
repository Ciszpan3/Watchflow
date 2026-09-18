import { describe, expect, it } from "vitest";
import { classifyVideo } from "./classification.js";

describe("YouTube video classification", () => {
  it("recognizes a short from duration and preserves Polish language", () => {
    const result = classifyVideo({
      snippet: { title: "Jak działa sztuczna inteligencja?", defaultAudioLanguage: "pl" },
      contentDetails: { duration: "PT2M59S" }
    });
    expect(result.format).toBe("short");
    expect(result.language).toBe("pl");
    expect(result.intents).toContain("learn");
  });

  it("recognizes long conversations as audio-friendly podcasts", () => {
    const result = classifyVideo({
      snippet: { title: "A long technology podcast conversation", description: "An interview about software design." },
      contentDetails: { duration: "PT1H5M" }
    });
    expect(result.format).toBe("podcast");
    expect(result.audioFriendly).toBe(true);
    expect(result.topics).toContain("technology");
  });

  it("gives live metadata priority over duration", () => {
    const result = classifyVideo({
      snippet: { title: "Live science Q&A", liveBroadcastContent: "live" },
      contentDetails: { duration: "PT30S" }
    });
    expect(result.format).toBe("live");
    expect(result.intents).toContain("company");
  });
});
