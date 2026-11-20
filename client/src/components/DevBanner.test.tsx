// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import DevBanner, { DevPill } from "./DevBanner";

beforeEach(() => {
  // jsdom has no index.html, so the prod title is set by hand.
  document.title = "PR Review Desk";
});

afterEach(() => {
  cleanup();
  document.title = "PR Review Desk";
});

describe("DevBanner", () => {
  it("shows nothing in prod", () => {
    render(<DevBanner health={{ mode: "prod", version: "a", branch: null, port: 3100 }} />);
    expect(screen.queryByText(/MODE DEV/)).toBeNull();
    expect(document.title).toBe("PR Review Desk");
  });

  it("shows the branch and port in dev and marks the tab", () => {
    render(<DevBanner health={{ mode: "dev", version: "b", branch: "feat/tray-mac", port: 3100 }} />);
    expect(screen.getByText("MODE DEV · branche feat/tray-mac · serveur :3100")).toBeTruthy();
    expect(document.title).toBe("[DEV] PR Review Desk");
  });

  it("restores the title on unmount", () => {
    const { unmount } = render(<DevBanner health={{ mode: "dev", version: "b", branch: "x", port: 3100 }} />);
    unmount();
    expect(document.title).toBe("PR Review Desk");
  });

  it("shows nothing while health is unknown", () => {
    render(<DevBanner health={null} />);
    expect(screen.queryByText(/MODE DEV/)).toBeNull();
  });

  it("puts the title back when the mode changes from dev to prod", () => {
    const dev = { mode: "dev", version: "b", branch: "x", port: 3100 } as const;
    const { rerender } = render(<DevBanner health={dev} />);
    expect(document.title).toBe("[DEV] PR Review Desk");
    rerender(<DevBanner health={{ ...dev, mode: "prod", branch: null }} />);
    expect(document.title).toBe("PR Review Desk");
    expect(screen.queryByText(/MODE DEV/)).toBeNull();
  });
});

describe("DevPill", () => {
  it("shows nothing in prod", () => {
    render(<DevPill health={{ mode: "prod", version: "a", branch: null, port: 3100 }} />);
    expect(screen.queryByText("DEV")).toBeNull();
  });

  it("shows nothing while health is unknown", () => {
    render(<DevPill health={null} />);
    expect(screen.queryByText("DEV")).toBeNull();
  });

  it("shows DEV in dev", () => {
    render(<DevPill health={{ mode: "dev", version: "b", branch: "x", port: 3100 }} />);
    expect(screen.getByText("DEV")).toBeTruthy();
  });
});
