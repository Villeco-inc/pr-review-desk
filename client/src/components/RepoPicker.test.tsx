// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateCache } from "../hooks/useApi";
import RepoPicker from "./RepoPicker";

const alpha = "Villeco-inc/alpha";
const beta = "Villeco-inc/beta";
const gamma = "Villeco-inc/gamma";
const delta = "Villeco-inc/delta";

beforeEach(() => {
  vi.useFakeTimers();
  // The network is the only thing replaced: the picker asks GitHub's list of repositories through the real fetchJson.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([alpha, beta, gamma, delta]), { status: 200 })));
});

afterEach(() => {
  cleanup(); // no globals here, so nothing unmounts a finished test's picker by itself
  invalidateCache("/api/");
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const rows = () => screen.getAllByRole("checkbox").map((box) => box.getAttribute("aria-label"));
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });

describe("RepoPicker", () => {
  it("lists the picked repositories first", async () => {
    render(<RepoPicker selected={[gamma]} required={false} onClose={() => {}} />);
    await flush();
    expect(rows()).toEqual([gamma, alpha, beta, delta]);
  });

  it("keeps its rows where they were when the selection changes elsewhere while it is open", async () => {
    const { rerender } = render(<RepoPicker selected={[gamma]} required={false} onClose={() => {}} />);
    await flush();

    rerender(<RepoPicker selected={[delta, gamma]} required={false} onClose={() => {}} />);
    await flush();
    expect(rows()).toEqual([gamma, alpha, beta, delta]);
  });
});
