// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultViewerProfile } from "../viewerApi";
import type { ViewerSignalsSummary } from "../viewerTypes";
import { OnboardingModal } from "./OnboardingModal";

const signals: ViewerSignalsSummary = {
  mode: "demo",
  connected: true,
  subscriptions: { state: "pending", detail: "Connected; live import is not active in this demo." },
  likedVideos: { state: "pending", detail: "Connected; live import is not active in this demo." },
  watchHistory: { state: "unavailable", detail: "Unavailable" },
  watchLater: { state: "unavailable", detail: "Unavailable" }
};

afterEach(cleanup);

function renderModal(overrides = {}) {
  const props = {
    open: true,
    profile: defaultViewerProfile,
    signals,
    editing: false,
    onProgress: vi.fn(),
    onComplete: vi.fn(),
    onSkip: vi.fn(),
    onClose: vi.fn(),
    ...overrides
  };
  render(<OnboardingModal {...props} />);
  return props;
}

describe("OnboardingModal", () => {
  it("requires at least three interests before continuing", () => {
    renderModal({ profile: { ...defaultViewerProfile, interests: [] } });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("at least three interests");
  });

  it("saves progress between steps and completes all three stages", () => {
    const props = renderModal();
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(screen.getByRole("heading", { name: "How do you like to watch?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(screen.getByRole("heading", { name: "How far should Watchflow look?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Finish setup/ }));
    expect(props.onProgress).toHaveBeenCalledTimes(2);
    expect(props.onComplete).toHaveBeenCalledWith(expect.objectContaining({ status: "completed", defaultSource: "mixed" }));
  });

  it("allows first-time setup to be skipped", () => {
    const props = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(props.onSkip).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped" }));
  });

  it("cancels editing without overwriting the saved profile", () => {
    const props = renderModal({ editing: true, profile: { ...defaultViewerProfile, status: "completed" as const } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel changes" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSkip).not.toHaveBeenCalled();
  });
});
