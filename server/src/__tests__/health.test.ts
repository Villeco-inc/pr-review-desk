import { describe, expect, it } from "vitest";
import { deskHealth, healthReader } from "../services/health";

const git = (out: Record<string, string>) => (a: string[]) => out[a.join(" ")] ?? null;

describe("deskHealth", () => {
  it("reports prod with the commit baked in the image", () =>
    expect(deskHealth({ NODE_ENV: "production", DESK_COMMIT: "a1b2c3d", PORT: "3100" }, git({}))).toEqual({ mode: "prod", version: "a1b2c3d", branch: null, port: 3100 }));

  it("reports dev with the branch and commit read from git", () =>
    expect(deskHealth({}, git({ "rev-parse --short HEAD": "b760681", "rev-parse --abbrev-ref HEAD": "feat/tray-mac" })))
      .toEqual({ mode: "dev", version: "b760681", branch: "feat/tray-mac", port: 3100 }));

  it("says inconnue when no version can be found", () => expect(deskHealth({ NODE_ENV: "production" }, git({})).version).toBe("inconnue"));
});

describe("healthReader", () => {
  const movingGit = (head: { sha: string }) => (a: string[]) =>
    a.join(" ") === "rev-parse --short HEAD" ? head.sha : a.join(" ") === "rev-parse --abbrev-ref HEAD" ? "feat/tray-mac" : null;

  it("in dev, reads git again on each call: a commit made under a running dev server shows", () => {
    const head = { sha: "b760681" };
    const read = healthReader({}, movingGit(head));
    head.sha = "c0ffee1";
    expect(read()).toEqual({ mode: "dev", version: "c0ffee1", branch: "feat/tray-mac", port: 3100 });
  });

  it("in prod, keeps what it read at start", () => {
    const head = { sha: "b760681" };
    const read = healthReader({ NODE_ENV: "production" }, movingGit(head));
    head.sha = "c0ffee1";
    expect(read().version).toBe("b760681");
  });
});
