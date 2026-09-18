// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncButton } from "./SyncButton";

describe("SyncButton", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("disables repeated sync attempts while a request is running", () => {
    const pending = new Promise(() => undefined);
    const onSync = vi.fn(() => pending);
    render(<SyncButton onSync={onSync} onComplete={vi.fn()} onError={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));

    expect(screen.getByRole("button", { name: "Syncing" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Connecting");
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it("shows the completed state after all demo stages", async () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    render(<SyncButton onSync={() => Promise.resolve()} onComplete={onComplete} onError={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2200);
    });

    expect(screen.getByRole("button", { name: "Synced" })).toBeEnabled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("reports request errors and returns to idle", async () => {
    const onError = vi.fn();
    render(<SyncButton onSync={() => Promise.reject(new Error("API offline"))} onComplete={vi.fn()} onError={onError} />);

    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await act(async () => Promise.resolve());

    expect(onError).toHaveBeenCalledWith("API offline");
    expect(screen.getByRole("button", { name: "Sync now" })).toBeEnabled();
  });
});
