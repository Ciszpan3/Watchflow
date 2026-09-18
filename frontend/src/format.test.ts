import { describe, expect, it } from "vitest";
import { formatNumber, formatPercent, formatTrend } from "./format";

describe("format utilities", () => {
  it("formats large numbers compactly", () => {
    expect(formatNumber(1420000)).toBe("1.4M");
  });

  it("formats percentages with one decimal place", () => {
    expect(formatPercent(0.0672)).toBe("6.7%");
  });

  it("formats positive and negative trends", () => {
    expect(formatTrend(6.4)).toBe("+6.4%");
    expect(formatTrend(-2)).toBe("-2.0%");
  });
});
