import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// tray/install.sh runs for real (swift build -c release, codesign) against a temporary HOME, with fake
// launchctl and open first on PATH: each appends its command line to calls.log. The release build of
// this checkout's tray/ is made once and reused (incrementally) by every case.

const CLONE = fs.realpathSync(path.resolve(__dirname, "../../.."));
const SCRIPT = path.join(CLONE, "tray/install.sh");
const LABEL = "com.villeco.pr-review-desk.tray";
const BUILD_FAILED =
  "Le tray n'a pas pu être compilé (Command Line Tools de Xcode absents ou trop anciens ?) : xcode-select --install, ou mets-les à jour dans Réglages Système > Mise à jour de logiciels";
const UID = process.getuid?.() ?? 0;

const FAKE_LAUNCHCTL = `#!/bin/sh
echo "launchctl $*" >> "$FAKE_STATE/calls.log"
[ "$1" = "print" ] && { [ -f "$FAKE_STATE/loaded" ] || exit 113; }
exit 0
`;
const FAKE_OPEN = `#!/bin/sh
echo "open $*" >> "$FAKE_STATE/calls.log"
`;
const FAKE_SWIFT_BROKEN = `#!/bin/sh
echo "error: compile failed"
exit 1
`;

const SLOW = 15 * 60 * 1000;
const USER_AGENT = "<plist>written by an earlier install</plist>\n";

// /usr/bin/swift exists on every Mac, but without the Command Line Tools it only offers to install them.
const canBuild =
  process.platform === "darwin" &&
  spawnSync("/bin/sh", ["-c", "command -v swift && xcode-select -p"], { stdio: "ignore" }).status === 0;

describe.skipIf(!canBuild)("tray/install.sh", () => {
  let root = "";
  let home = "";
  let state = "";
  let fakeBin = "";
  let brokenBin = "";

  const app = () => path.join(home, "Applications/PR Review Desk.app");
  const agent = () => path.join(home, "Library/LaunchAgents", `${LABEL}.plist`);
  const configFile = () => path.join(home, "Library/Application Support/PR Review Desk/config.json");
  const calls = () => {
    const log = path.join(state, "calls.log");
    const text = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "";
    return text.split("\n").filter(Boolean);
  };
  const plist = (file: string) => {
    const r = spawnSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout);
  };
  const install = (args: string[] = [], extraPath: string[] = []) => {
    const r = spawnSync("/bin/bash", [SCRIPT, CLONE, ...args], {
      encoding: "utf8",
      timeout: SLOW,
      env: {
        ...process.env,
        HOME: home,
        FAKE_STATE: state,
        PATH: [...extraPath, fakeBin, process.env.PATH ?? "/usr/bin:/bin"].join(":"),
      },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  /** A tray installed by an earlier run: an old bundle, its config, and the LaunchAgent unless the user turned it off. */
  const installedBefore = (opts: { agent: boolean; loaded?: boolean }) => {
    fs.mkdirSync(path.join(app(), "Contents/MacOS"), { recursive: true });
    fs.writeFileSync(path.join(app(), "Contents/old-marker"), "");
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), '{"clonePath": "/ancien", "trayTree": "abc"}\n');
    if (opts.agent) {
      fs.mkdirSync(path.dirname(agent()), { recursive: true });
      fs.writeFileSync(agent(), USER_AGENT);
    }
    if (opts.loaded) fs.writeFileSync(path.join(state, "loaded"), "");
  };

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "prd-tray-install-"));
    fakeBin = path.join(root, "bin");
    brokenBin = path.join(root, "broken-bin");
    for (const dir of [fakeBin, brokenBin]) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(fakeBin, "launchctl"), FAKE_LAUNCHCTL, { mode: 0o755 });
    fs.writeFileSync(path.join(fakeBin, "open"), FAKE_OPEN, { mode: 0o755 });
    fs.writeFileSync(path.join(brokenBin, "swift"), FAKE_SWIFT_BROKEN, { mode: 0o755 });

    // The real launchctl must never be reached: refuse to run any case unless the fake is the one resolved.
    const resolved = spawnSync("/bin/bash", ["-c", "command -v launchctl; command -v open"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    });
    expect(resolved.stdout.trim().split("\n")).toEqual([path.join(fakeBin, "launchctl"), path.join(fakeBin, "open")]);
  });

  beforeEach(() => {
    const run = fs.mkdtempSync(path.join(root, "run-"));
    home = path.join(run, "home");
    state = path.join(run, "state");
    for (const dir of [home, state]) fs.mkdirSync(dir, { recursive: true });
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("first install with --login: builds the signed bundle, writes config.json and the LaunchAgent, then bootstraps it", { timeout: SLOW }, () => {
    const r = install(["--login"]);
    expect(r.code, r.out).toBe(0);

    const binary = path.join(app(), "Contents/MacOS/DeskTray");
    expect(fs.statSync(binary).mode & 0o111).not.toBe(0);
    const info = plist(path.join(app(), "Contents/Info.plist"));
    expect(info).toMatchObject({
      LSUIElement: true,
      CFBundleIdentifier: "com.villeco.pr-review-desk.tray",
      CFBundleName: "PR Review Desk",
      CFBundleExecutable: "DeskTray",
      CFBundleIconFile: "AppIcon",
    });
    const icon = path.join(app(), "Contents/Resources/AppIcon.icns");
    expect(fs.readFileSync(icon).subarray(0, 4).toString("latin1")).toBe("icns");
    expect(spawnSync("codesign", ["--verify", app()]).status).toBe(0);

    const raw = fs.readFileSync(configFile(), "utf8");
    expect(raw).not.toContain("\\/");
    const tree = spawnSync("git", ["-C", CLONE, "rev-parse", "HEAD:tray"], { encoding: "utf8" }).stdout.trim();
    expect(JSON.parse(raw)).toEqual({ clonePath: CLONE, trayTree: tree });

    expect(plist(agent())).toEqual({
      Label: LABEL,
      ProgramArguments: [binary],
      RunAtLoad: true,
      KeepAlive: false,
    });
    expect(calls()).toEqual([`launchctl print gui/${UID}/${LABEL}`, `launchctl bootstrap gui/${UID} ${agent()}`]);
  });

  it("first install with --no-login: writes no LaunchAgent and opens the new app", { timeout: SLOW }, () => {
    const r = install(["--no-login"]);
    expect(r.code, r.out).toBe(0);
    expect(fs.existsSync(path.join(app(), "Contents/MacOS/DeskTray"))).toBe(true);
    expect(fs.existsSync(agent())).toBe(false);
    expect(calls()).toEqual([`open -n ${app()}`]);
  });

  it("first install with --no-login removes a LaunchAgent left by a deleted bundle", { timeout: SLOW }, () => {
    fs.mkdirSync(path.dirname(agent()), { recursive: true });
    fs.writeFileSync(agent(), USER_AGENT);
    const r = install(["--no-login"]);
    expect(r.code, r.out).toBe(0);
    expect(fs.existsSync(agent())).toBe(false);
    expect(calls()).toEqual([`open -n ${app()}`]);
  });

  it("first install without a flag still writes the LaunchAgent", { timeout: SLOW }, () => {
    const r = install();
    expect(r.code, r.out).toBe(0);
    expect(fs.readFileSync(agent(), "utf8")).toContain(LABEL);
    expect(calls()).toEqual([`launchctl print gui/${UID}/${LABEL}`, `launchctl bootstrap gui/${UID} ${agent()}`]);
  });

  it("--build-only compiles and installs nothing", { timeout: SLOW }, () => {
    const r = install(["--build-only"]);
    expect(r.code, r.out).toBe(0);
    expect(fs.existsSync(path.join(home, "Applications"))).toBe(false);
    expect(fs.existsSync(configFile())).toBe(false);
    expect(fs.existsSync(agent())).toBe(false);
    expect(calls()).toEqual([]);

    const broken = install(["--build-only"], [brokenBin]);
    expect(broken.code).toBe(1);
    expect(broken.out.trim().split("\n").at(-1)).toBe(BUILD_FAILED);
  });

  it("reinstall with --login or --no-login keeps the user's LaunchAgent choice", { timeout: SLOW }, () => {
    installedBefore({ agent: false });
    expect(install(["--login"]).code).toBe(0);
    expect(fs.existsSync(agent())).toBe(false);
    expect(calls()).toEqual([`open -n ${app()}`]);

    installedBefore({ agent: true });
    expect(install(["--no-login"]).code).toBe(0);
    expect(fs.readFileSync(agent(), "utf8")).toBe(USER_AGENT);
  });

  it("reinstall with launch at login on and the job loaded: swaps the bundle, keeps the LaunchAgent, kickstart -k", { timeout: SLOW }, () => {
    installedBefore({ agent: true, loaded: true });
    const r = install();
    expect(r.code, r.out).toBe(0);

    expect(fs.existsSync(path.join(app(), "Contents/old-marker"))).toBe(false);
    expect(fs.existsSync(path.join(app(), "Contents/MacOS/DeskTray"))).toBe(true);
    expect(fs.readdirSync(app())).toEqual(["Contents"]);
    expect(fs.readdirSync(path.join(home, "Applications"))).toEqual(["PR Review Desk.app"]);
    expect(JSON.parse(fs.readFileSync(configFile(), "utf8")).clonePath).toBe(CLONE);
    expect(fs.readFileSync(agent(), "utf8")).toBe(USER_AGENT);
    expect(calls()).toEqual([`launchctl print gui/${UID}/${LABEL}`, `launchctl kickstart -k gui/${UID}/${LABEL}`]);
  });

  it("reinstall with launch at login on but the job not loaded: bootstraps it", { timeout: SLOW }, () => {
    installedBefore({ agent: true });
    const r = install();
    expect(r.code, r.out).toBe(0);
    expect(fs.readFileSync(agent(), "utf8")).toBe(USER_AGENT);
    expect(calls()).toEqual([`launchctl print gui/${UID}/${LABEL}`, `launchctl bootstrap gui/${UID} ${agent()}`]);
  });

  it("reinstall after launch at login was turned off: no LaunchAgent created, the new app is opened", { timeout: SLOW }, () => {
    installedBefore({ agent: false });
    const r = install();
    expect(r.code, r.out).toBe(0);
    expect(fs.existsSync(agent())).toBe(false);
    expect(fs.existsSync(path.join(app(), "Contents/old-marker"))).toBe(false);
    expect(calls()).toEqual([`open -n ${app()}`]);
  });

  it("compile failure: says how to get the Command Line Tools, exits 1 and touches nothing", { timeout: SLOW }, () => {
    installedBefore({ agent: false });
    const r = install([], [brokenBin]);
    expect(r.code).toBe(1);
    expect(r.out.trim().split("\n").at(-1)).toBe(BUILD_FAILED);
    expect(fs.existsSync(path.join(app(), "Contents/old-marker"))).toBe(true);
    expect(fs.readFileSync(configFile(), "utf8")).toBe('{"clonePath": "/ancien", "trayTree": "abc"}\n');
    expect(fs.existsSync(agent())).toBe(false);
    expect(calls()).toEqual([]);
  });

  it("unknown argument: usage line, exit 2, nothing built", () => {
    const r = install(["--from-tray"], [brokenBin]);
    expect(r.code).toBe(2);
    expect(r.out.trim()).toBe("Usage : tray/install.sh <clone> [--login | --no-login | --build-only]");
    expect(calls()).toEqual([]);
  });
});
