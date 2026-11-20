import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

// start.sh runs against fake gh, claude, brew, curl, docker and uname placed first on PATH.
// Each fake appends its command line to calls.log; the fake gh keeps its login in state/.

const SCRIPT = path.resolve(__dirname, "../../../start.sh");
const GH_VERSION = "2.102.0";
const GH_ZIP = `gh_${GH_VERSION}_macOS_arm64.zip`;

const FAKE_GH = `#!/bin/sh
echo "gh $*" >> "$FAKE_STATE/calls.log"
case "$1 $2" in
  "auth token")
    [ -f "$FAKE_STATE/gh-logged-in" ] || exit 1
    if [ "$3" = "--user" ]; then
      [ "$4" = "autre-login" ] && { echo gho_autre; exit 0; }
      exit 1
    fi
    echo gho_active ;;
  "auth login")
    [ -f "$FAKE_STATE/gh-login-fails" ] && exit 1
    touch "$FAKE_STATE/gh-logged-in" ;;
  "config get")
    [ -f "$FAKE_STATE/gh-git-protocol" ] && cat "$FAKE_STATE/gh-git-protocol" ;;
esac
`;

const FAKE_CLAUDE = `#!/bin/sh
echo "claude $*" >> "$FAKE_STATE/calls.log"
[ "$1" = "setup-token" ] && echo "Your OAuth token: sk-ant-oat01-fake"
exit 0
`;

const FAKES: Record<string, string> = {
  docker: `#!/bin/sh
[ -f "$FAKE_STATE/docker-down" ] && [ "$1" = "info" ] && exit 1
if [ -f "$FAKE_STATE/docker-flaky" ] && [ "$1" = "info" ] && [ ! -f "$FAKE_STATE/docker-info-seen" ]; then touch "$FAKE_STATE/docker-info-seen"; exit 1; fi
if [ "$1" = "ps" ]; then port="\${3#publish=}"; [ -f "$FAKE_STATE/port-owner-$port" ] && cat "$FAKE_STATE/port-owner-$port"; exit 0; fi
if [ "$1" = "compose" ]; then echo "docker $* GH_TOKEN=$GH_TOKEN DESK_COMMIT=$DESK_COMMIT" >> "$FAKE_STATE/calls.log"; else echo "docker $*" >> "$FAKE_STATE/calls.log"; fi
if [ "$1" = "compose" ]; then
  printf '%s\n' "\${BUILDKIT_PROGRESS:-}" > "$FAKE_STATE/buildkit-progress"
  echo "#1 [internal] load build definition from Dockerfile"
  echo "#5 [build 1/4] FROM docker.io/library/node:22-slim"
  echo "#6 [build 2/4] RUN npm ci"
  echo "#6 DONE 1.2s"
  if [ -f "$FAKE_STATE/compose-fails" ]; then
    i=1; while [ $i -le 20 ]; do echo "#7 npm error line $i"; i=$((i + 1)); done
    echo "#7 ERROR: process npm run build did not complete successfully: exit code: 1" >&2
    exit 1
  fi
  echo " Container prd-app-1  Started"
fi
exit 0
`,
  nc: `#!/bin/sh
for port; do :; done
[ -f "$FAKE_STATE/port-busy-$port" ]
`,
  swift: `#!/bin/sh
[ "$1" = "--version" ] && echo "swift-driver version: 1.120.5 Apple Swift version \${FAKE_SWIFT_VERSION:-6.1.2} (swiftlang-6.1.2.1.2 clang-1700.0.13.5)" && echo "Target: arm64-apple-macosx15.0"
exit 0
`,
  "xcode-select": `#!/bin/sh
echo "xcode-select $*" >> "$FAKE_STATE/calls.log"
[ "$1" = "-p" ] || exit 0
case "$FAKE_CLT" in
  ready) echo /Library/Developer/CommandLineTools; exit 0 ;;
  never) exit 2 ;;
esac
n=$(cat "$FAKE_STATE/clt-probes" 2>/dev/null || echo 0)
echo $((n + 1)) > "$FAKE_STATE/clt-probes"
[ "$n" -ge 1 ] && { echo /Library/Developer/CommandLineTools; exit 0; }
exit 2
`,
  pgrep: `#!/bin/sh
[ -f "$FAKE_STATE/tray-running" ]
`,
  uname: `#!/bin/sh
case "$1" in -s) echo "\${FAKE_OS:-Darwin}" ;; -m) echo arm64 ;; esac
`,
  brew: `#!/bin/sh
echo "brew $*" >> "$FAKE_STATE/calls.log"
[ "$1 $2" = "install gh" ] && cp "$FAKE_STATE/stash/gh" "$FAKE_BIN/gh"
exit 0
`,
  curl: `#!/bin/sh
echo "curl $*" >> "$FAKE_STATE/calls.log"
out=""; url=""
while [ $# -gt 0 ]; do
  case "$1" in -o) out="$2"; shift ;; -*) ;; *) url="$1" ;; esac
  shift
done
case "$url" in
  https://claude.ai/install.sh)
    printf 'mkdir -p "$HOME/.local/bin" && cp "$FAKE_STATE/stash/claude" "$HOME/.local/bin/claude"\\n' ;;
  */releases/latest) echo '{"url": "x", "tag_name": "v${GH_VERSION}", "name": "GitHub CLI ${GH_VERSION}"}' ;;
  */${GH_ZIP}) cp "$FAKE_STATE/stash/${GH_ZIP}" "$out" ;;
  */gh_${GH_VERSION}_checksums.txt) cp "$FAKE_STATE/stash/checksums.txt" "$out" ;;
  *) exit 22 ;;
esac
`,
};

let zipChecksum = "";
const roots: string[] = [];

beforeAll(() => {
  const build = fs.mkdtempSync(path.join(os.tmpdir(), "prd-ghzip-"));
  roots.push(build);
  const binDir = path.join(build, `gh_${GH_VERSION}_macOS_arm64`, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "gh"), FAKE_GH, { mode: 0o755 });
  spawnSync("zip", ["-qr", GH_ZIP, `gh_${GH_VERSION}_macOS_arm64`], { cwd: build });
  zipChecksum = createHash("sha256").update(fs.readFileSync(path.join(build, GH_ZIP))).digest("hex");
});

afterEach(() => {
  for (const dir of roots.splice(1)) fs.rmSync(dir, { recursive: true, force: true });
});

interface Machine {
  os?: "Darwin" | "Linux";
  gh?: boolean;
  ghLoggedIn?: boolean;
  ghLoginFails?: boolean;
  claude?: boolean;
  brew?: boolean;
  /** "flaky": the first docker info fails, the next ones succeed (the user started OrbStack meanwhile). */
  docker?: "running" | "stopped" | "missing" | "flaky";
  env?: string | null;
  badChecksum?: boolean;
  busyPort?: number;
  /** Folder of the Compose project whose container publishes busyPort: "self" is this checkout. */
  portOwner?: "self" | string;
  /** Command Line Tools: "ready" (default), "missing" (xcode-select -p fails once, then succeeds) or "never". */
  clt?: "ready" | "missing" | "never";
  /** Version printed by swift --version (default 6.1.2). */
  swift?: string;
}

function setUp(m: Machine = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prd-start-"));
  roots.push(root);
  const project = path.join(root, "project");
  const bin = path.join(root, "bin");
  const state = path.join(root, "state");
  const home = path.join(root, "home");
  for (const d of [project, bin, path.join(state, "stash"), home]) fs.mkdirSync(d, { recursive: true });

  fs.copyFileSync(SCRIPT, path.join(project, "start.sh"));
  const env = m.env === undefined ? "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-saved\nREPOS_ROOT=/Users/danngossinga/workspace\n" : m.env;
  if (env !== null) fs.writeFileSync(path.join(project, ".env"), env);

  const write = (dir: string, name: string, body: string) => fs.writeFileSync(path.join(dir, name), body, { mode: 0o755 });
  write(bin, "uname", FAKES.uname);
  write(bin, "curl", FAKES.curl);
  write(bin, "nc", FAKES.nc);
  write(bin, "xcode-select", FAKES["xcode-select"]);
  write(bin, "swift", FAKES.swift);
  write(bin, "pgrep", FAKES.pgrep);
  if (m.busyPort) fs.writeFileSync(path.join(state, `port-busy-${m.busyPort}`), "");
  if (m.busyPort && m.portOwner) {
    const owner = m.portOwner === "self" ? fs.realpathSync(project) : m.portOwner;
    fs.writeFileSync(path.join(state, `port-owner-${m.busyPort}`), `${owner}\n`);
  }
  if ((m.docker ?? "running") !== "missing") write(bin, "docker", FAKES.docker);
  if (m.docker === "stopped") fs.writeFileSync(path.join(state, "docker-down"), "");
  if (m.docker === "flaky") fs.writeFileSync(path.join(state, "docker-flaky"), "");
  if (m.brew ?? true) write(bin, "brew", FAKES.brew);
  if (m.gh ?? true) write(bin, "gh", FAKE_GH);
  if (m.claude ?? true) write(bin, "claude", FAKE_CLAUDE);
  write(path.join(state, "stash"), "gh", FAKE_GH);
  write(path.join(state, "stash"), "claude", FAKE_CLAUDE);
  fs.copyFileSync(path.join(roots[0], GH_ZIP), path.join(state, "stash", GH_ZIP));
  const sum = m.badChecksum ? "0".repeat(64) : zipChecksum;
  fs.writeFileSync(path.join(state, "stash", "checksums.txt"), `${"f".repeat(64)}  gh_${GH_VERSION}_linux_amd64.tar.gz\n${sum}  ${GH_ZIP}\n`);
  if (m.ghLoggedIn ?? true) fs.writeFileSync(path.join(state, "gh-logged-in"), "");
  if (m.ghLoginFails) fs.writeFileSync(path.join(state, "gh-login-fails"), "");

  const run = (input = "", args: string[] = [], dir = project, extraEnv: Record<string, string> = {}) => {
    const r = spawnSync("/bin/bash", [path.join(dir, "start.sh"), ...args], {
      cwd: root,
      input,
      encoding: "utf8",
      env: { PATH: `${bin}:/usr/bin:/bin`, LANG: "fr_CA.UTF-8", HOME: home, FAKE_STATE: state, FAKE_BIN: bin, FAKE_OS: m.os ?? "Darwin", FAKE_CLT: m.clt ?? "ready", FAKE_SWIFT_VERSION: m.swift ?? "6.1.2", DESK_CLT_POLL_SECONDS: "0.1", DESK_CLT_WAIT_SECONDS: "1", DESK_TRAY_WAIT_SECONDS: "0", ...extraEnv },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}`, err: r.stderr };
  };
  const calls = () => {
    const file = path.join(state, "calls.log");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n") : [];
  };
  const readEnv = () => fs.readFileSync(path.join(project, ".env"), "utf8");
  const started = () => calls().filter((c) => c.startsWith("docker compose"));
  return { run, calls, readEnv, started, project, home, state, root };
}

function filesContaining(dir: string, needle: string): string[] {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath, e.name))
    .filter((f) => fs.readFileSync(f, "utf8").includes(needle));
}

describe("start.sh on a machine already set up", () => {
  it("starts the app with the gh token, asks nothing and writes the token nowhere", () => {
    const m = setUp();
    const before = m.readEnv();
    const r = m.run();
    expect(r.code).toBe(0);
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_active DESK_COMMIT=inconnue"]);
    expect(r.out).toContain("http://localhost:37703");
    expect(m.readEnv()).toBe(before);
    expect(filesContaining(m.project, "gho_active")).toEqual([]);
    expect(m.calls()).not.toContain("claude setup-token");
  });

  it("prints the port set in .env", () => {
    const m = setUp({ env: "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-saved\nHOST_PORT=4100\n" });
    expect(m.run().out).toContain("http://localhost:4100");
  });

  it("uses another gh account with --user", () => {
    const m = setUp();
    expect(m.run("", ["--user", "autre-login"]).code).toBe(0);
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_autre DESK_COMMIT=inconnue"]);
  });

  it("remembers --user for the next starts", () => {
    const m = setUp();
    m.run("", ["--user", "autre-login"]);
    m.run();
    expect(m.started()).toEqual([
      "docker compose up -d --build GH_TOKEN=gho_autre DESK_COMMIT=inconnue",
      "docker compose up -d --build GH_TOKEN=gho_autre DESK_COMMIT=inconnue",
    ]);
    expect(fs.readFileSync(path.join(m.project, ".desk/gh-user"), "utf8").trim()).toBe("autre-login");
    expect(filesContaining(m.project, "gho_autre")).toEqual([]);
  });

  it("lets --user override the remembered login and replace it", () => {
    const m = setUp();
    fs.mkdirSync(path.join(m.project, ".desk"));
    fs.writeFileSync(path.join(m.project, ".desk/gh-user"), "ancien-login\n");
    m.run("", ["--user", "autre-login"]);
    expect(m.calls()).toContain("gh auth token --user autre-login");
    expect(fs.readFileSync(path.join(m.project, ".desk/gh-user"), "utf8").trim()).toBe("autre-login");
  });

  it("passes the checkout's commit to the image", () => {
    const m = setUp();
    const git = (...args: string[]) => spawnSync("git", args, { cwd: m.project, encoding: "utf8" });
    git("init", "-q");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    git("commit", "-q", "--allow-empty", "-m", "init");
    expect(m.run().code).toBe(0);
    expect(m.started()[0]).toMatch(/DESK_COMMIT=[0-9a-f]{7}$/);
  });

  it("rejects an unknown option without starting anything", () => {
    const m = setUp();
    const r = m.run("", ["--nope"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("--user");
    expect(m.started()).toEqual([]);
  });
});

describe("start.sh and the Desk build", () => {
  const log = (m: ReturnType<typeof setUp>) => fs.readFileSync(path.join(m.project, ".desk/start.log"), "utf8");

  it("writes the build output to .desk/start.log, in BuildKit's plain format, and not to the terminal", () => {
    const m = setUp();
    const r = m.run();
    expect(r.code).toBe(0);
    expect(log(m)).toContain("#6 [build 2/4] RUN npm ci\n");
    expect(log(m)).toContain("Container prd-app-1  Started");
    expect(fs.readFileSync(path.join(m.state, "buildkit-progress"), "utf8")).toBe("plain\n");
    expect(r.out).toContain("Construction du Desk…");
    expect(r.out).not.toContain("npm ci");
    expect(r.out).not.toContain("Container prd-app-1");
  });

  it("starts the log afresh at each start", () => {
    const m = setUp();
    m.run();
    m.run();
    expect(log(m).split("#6 [build 2/4] RUN npm ci").length - 1).toBe(1);
  });

  it("on failure, shows the end of the log and its path, then one ✗ line", () => {
    const m = setUp();
    fs.writeFileSync(path.join(m.state, "compose-fails"), "");
    const r = m.run();
    expect(r.code).toBe(1);
    const err = r.err.trim().split("\n");
    expect(err.at(-1)).toBe("✗ docker compose up a échoué.");
    expect(err.filter((l) => l.startsWith("✗"))).toHaveLength(1);
    expect(r.err).toContain(".desk/start.log");
    expect(r.err).toContain("exit code: 1");
    expect(r.err).toContain("npm error line 20");
    expect(r.err).not.toContain("npm error line 5\n");
    expect(r.out).not.toContain("#5 [build 1/4]");
  });
});

describe("start.sh output", () => {
  const ESC = "\u001b";

  it("a later launch fits on a few lines: one line of checks, the build, and the ready summary", () => {
    const m = setUp();
    const r = m.run();
    expect(r.code).toBe(0);
    expect(r.out).toContain("✓ Docker · ✓ GitHub · ✓ Claude\n");
    expect(r.out).not.toContain("installation");
    expect(r.out).not.toContain("[O/n]");
    expect(r.out).toMatch(/✨ C'est prêt\n\s*http:\/\/localhost:37703\n/);
    expect(r.out).not.toContain("Ou clique l'icône");
  });

  it("a first launch starts with the route of the steps", () => {
    const m = setUp({ env: null });
    const r = m.run("\nsk-ant-oat01-pasted\n");
    expect(r.code).toBe(0);
    expect(r.out).toContain("PR Review Desk  installation\nDocker → GitHub → Claude → Desk\n");
    expect(r.out).toContain("✓ Claude : token enregistré");
  });

  it("is plain text without a terminal, with NO_COLOR, with TERM=dumb and with --no-prompt", () => {
    const m = setUp({ env: null });
    expect(m.run("\nsk-ant-oat01-pasted\n").out).not.toContain(ESC);
    expect(m.run("", [], m.project, { DESK_UI: "rich", NO_COLOR: "1", TERM: "xterm-256color" }).out).not.toContain(ESC);
    expect(m.run("", [], m.project, { DESK_UI: "rich", TERM: "dumb" }).out).not.toContain(ESC);
    expect(m.run("", ["--no-prompt"], m.project, { DESK_UI: "rich", TERM: "xterm-256color" }).out).not.toContain(ESC);
  });

  it("at a terminal, draws the header box and the list of steps", () => {
    const m = setUp({ env: null });
    const r = m.run("\nsk-ant-oat01-pasted\n", [], m.project, { DESK_UI: "rich", TERM: "xterm-256color", COLUMNS: "80" });
    expect(r.code).toBe(0);
    expect(r.out).toContain(ESC);
    expect(r.out).toMatch(/╭─+╮/);
    expect(r.out).toContain("PR Review Desk  installation");
    expect(r.out).toMatch(/●\S* Docker +\S*répond/);
    expect(r.out).toMatch(/●\S* Claude +\S*token enregistré/);
    expect(r.out).toMatch(/●\S* Desk +\S*http:\/\/localhost:37703/);
    expect(r.out).toContain("✨ C'est prêt");
  });
});

describe("start.sh and Docker", () => {
  it("asks to install a Docker client before touching anything else", () => {
    const m = setUp({ docker: "missing", gh: false });
    const r = m.run("o\n");
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Docker n'est pas installé. Installe un client Docker (OrbStack, Docker Desktop, Colima…), puis relance ./start.sh.");
    expect(m.calls()).toEqual([]);
  });

  it("with Docker silent and no input, says to start Docker and stops", () => {
    const m = setUp({ docker: "stopped" });
    const r = m.run();
    expect(r.code).toBe(1);
    expect(r.out).toContain("Docker ne tourne pas. Démarre-le, puis reviens ici.");
    expect(r.out).toContain("Appuie sur Entrée pour vérifier à nouveau (Ctrl-C pour quitter).");
    expect(r.out).toContain("✗ Docker n'est pas démarré.");
    expect(m.started()).toEqual([]);
    expect(m.calls().filter((c) => c.startsWith("gh"))).toEqual([]);
  });

  it("with Docker silent, checks again at each Enter and carries on once it answers", () => {
    const m = setUp({ docker: "flaky" });
    const r = m.run("\n");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Docker ne tourne pas.");
    expect(fs.existsSync(path.join(m.state, "docker-info-seen"))).toBe(true);
    expect(m.calls()).toContain("docker info");
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_active DESK_COMMIT=inconnue"]);
  });

  it("keeps waiting while Docker stays silent, one check per Enter", () => {
    const m = setUp({ docker: "stopped" });
    const r = m.run("\n\n\n");
    expect(r.code).toBe(1);
    expect(r.out.split("Appuie sur Entrée").length - 1).toBe(4);
    expect(m.started()).toEqual([]);
  });
});

describe("start.sh --no-prompt", () => {
  const NO_PROMPT = ["--no-prompt"];
  const forbidden = (m: ReturnType<typeof setUp>) =>
    m.calls().filter((c) => /^(brew install|gh auth login|claude setup-token|curl)/.test(c) || c.startsWith("open"));

  it("on Linux, points to gh's Linux install page when gh is missing", () => {
    const m = setUp({ gh: false, os: "Linux" });
    const r = m.run("", NO_PROMPT);
    expect(r.code).toBe(1);
    expect(r.err.trim().split("\n").pop()).toBe("✗ gh n'est pas installé. Installe-le (https://github.com/cli/cli/blob/trunk/docs/install_linux.md), puis relance ./start.sh.");
    expect(forbidden(m)).toEqual([]);
  });

  it("fails when gh is missing, without installing it", () => {
    const m = setUp({ gh: false });
    const r = m.run("o\no\n", NO_PROMPT);
    expect(r.code).toBe(1);
    expect(r.out).toContain("✗ gh n'est pas installé. Lance ./start.sh dans un terminal pour l'installer.");
    expect(forbidden(m)).toEqual([]);
    expect(m.started()).toEqual([]);
  });

  it("fails when claude is missing and .env has no token, without installing it", () => {
    const m = setUp({ claude: false, env: null });
    const r = m.run("o\no\n", NO_PROMPT);
    expect(r.code).toBe(1);
    expect(r.out).toContain("✗ Le token Claude manque. Lance ./start.sh dans un terminal.");
    expect(forbidden(m)).toEqual([]);
    expect(m.started()).toEqual([]);
  });

  it("fails when no gh account is connected, without running gh auth login", () => {
    const m = setUp({ ghLoggedIn: false });
    const r = m.run("o\no\n", NO_PROMPT);
    expect(r.code).toBe(1);
    expect(r.out).toContain("✗ GitHub n'est pas connecté. Lance ./start.sh dans un terminal.");
    expect(forbidden(m)).toEqual([]);
    expect(m.started()).toEqual([]);
  });

  it("fails when the Claude token is missing, without running claude setup-token", () => {
    const m = setUp({ env: "REPOS_ROOT=/x\n" });
    const r = m.run("o\nsk-ant-oat01-pasted\n", NO_PROMPT);
    expect(r.code).toBe(1);
    expect(r.out).toContain("✗ Le token Claude manque. Lance ./start.sh dans un terminal.");
    expect(forbidden(m)).toEqual([]);
    expect(m.readEnv()).toBe("REPOS_ROOT=/x\n");
    expect(m.started()).toEqual([]);
  });

  it("fails when Docker is silent, without waiting for Enter or starting anything", () => {
    const m = setUp({ docker: "stopped" });
    const r = m.run("o\no\n", NO_PROMPT);
    expect(r.code).toBe(1);
    expect(r.out).toContain("✗ Docker n'est pas démarré.");
    expect(r.out).not.toContain("Appuie sur Entrée");
    expect(forbidden(m)).toEqual([]);
    expect(m.started()).toEqual([]);
  });

  it("fails when Docker is missing, never opening anything", () => {
    const m = setUp({ docker: "missing" });
    const r = m.run("o\no\n", NO_PROMPT);
    expect(r.code).toBe(1);
    expect(r.out).toContain("✗ Docker n'est pas installé. Installe un client Docker (OrbStack, Docker Desktop, Colima…), puis relance ./start.sh.");
    expect(m.calls()).toEqual([]);
  });

  it("starts and exits 0 on a machine that is ready", () => {
    const m = setUp();
    const r = m.run("o\no\n", NO_PROMPT);
    expect(r.code).toBe(0);
    expect(forbidden(m)).toEqual([]);
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_active DESK_COMMIT=inconnue"]);
  });

  it("ends on the ✗ line when the remembered login has no token, and names the file", () => {
    const m = setUp();
    fs.mkdirSync(path.join(m.project, ".desk"));
    fs.writeFileSync(path.join(m.project, ".desk/gh-user"), "vieux-login\n");
    const r = m.run("o\n", NO_PROMPT);
    expect(r.code).toBe(1);
    expect(r.out.trim().split("\n").pop()).toBe(
      "✗ gh n'a pas de token pour vieux-login (compte retenu dans .desk/gh-user). Relance ./start.sh --user <ton-login>, ou supprime .desk/gh-user."
    );
    expect(forbidden(m)).toEqual([]);
    expect(m.started()).toEqual([]);
  });
});

describe("start.sh and a remembered GitHub login with no token", () => {
  it("names .desk/gh-user and the fix when the saved login is stale", () => {
    const m = setUp();
    fs.mkdirSync(path.join(m.project, ".desk"));
    fs.writeFileSync(path.join(m.project, ".desk/gh-user"), "vieux-login\n");
    const r = m.run();
    expect(r.code).toBe(1);
    expect(r.out).toContain("gh n'a pas de token pour vieux-login (compte retenu dans .desk/gh-user). Relance ./start.sh --user <ton-login>, ou supprime .desk/gh-user.");
    expect(m.started()).toEqual([]);
  });

  it("leaves .desk/gh-user untouched when --user names a login gh has no token for", () => {
    const m = setUp();
    fs.mkdirSync(path.join(m.project, ".desk"));
    fs.writeFileSync(path.join(m.project, ".desk/gh-user"), "ancien-login\n");
    const r = m.run("", ["--user", "inconnu"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("gh n'a pas de token pour inconnu");
    expect(r.out).not.toContain("compte retenu");
    expect(fs.readFileSync(path.join(m.project, ".desk/gh-user"), "utf8")).toBe("ancien-login\n");
  });
});

describe("start.sh and the port", () => {
  it("stops before installing or starting anything when another app holds the port", () => {
    const m = setUp({ busyPort: 37703, gh: false });
    const r = m.run("o\n");
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Le port 37703 est déjà utilisé");
    expect(r.out).toContain("HOST_PORT=37704");
    expect(m.calls()).toEqual(["docker info"]);
  });

  it("checks the port set in .env", () => {
    const m = setUp({ busyPort: 4100, env: "CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-saved\nHOST_PORT=4100\n" });
    const r = m.run();
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Le port 4100 est déjà utilisé");
    expect(m.started()).toEqual([]);
  });

  it("restarts normally when the port is held by this app's own container", () => {
    const m = setUp({ busyPort: 37703, portOwner: "self" });
    expect(m.run().code).toBe(0);
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_active DESK_COMMIT=inconnue"]);
  });

  it("restarts and asks for a new Claude token when its line was emptied", () => {
    const m = setUp({ busyPort: 37703, portOwner: "self", env: "CLAUDE_CODE_OAUTH_TOKEN=\n" });
    expect(m.run("\nsk-ant-oat01-new\n").code).toBe(0);
    expect(m.readEnv()).toBe("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-new\n");
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_active DESK_COMMIT=inconnue"]);
  });

  it("stops when the port is held by another checkout, even one in a folder with the same name", () => {
    const m = setUp({ busyPort: 37703, portOwner: "/Users/someone/Documents/project" });
    const r = m.run();
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Le port 37703 est déjà utilisé");
    expect(m.started()).toEqual([]);
  });
});

describe("start.sh installing gh on a Mac", () => {
  it("explains what gh is for before asking, and installs it on Enter", () => {
    const m = setUp({ gh: false });
    const r = m.run("\n");
    expect(r.code).toBe(0);
    expect(r.out).toContain("gh (GitHub CLI) permet au Desk de lire tes PR avec ton compte GitHub.");
    expect(r.out).toContain("Installer gh ? [O/n]");
    expect(m.calls()).toContain("brew install gh");
  });

  it("installs gh with Homebrew when the answer is yes", () => {
    const m = setUp({ gh: false });
    const r = m.run("o\n");
    expect(r.code).toBe(0);
    expect(m.calls()).toContain("brew install gh");
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_active DESK_COMMIT=inconnue"]);
  });

  it("installs nothing on no or without an answer, says how to install it, and stops", () => {
    for (const answer of ["N\n", "non\n", ""]) {
      const m = setUp({ gh: false });
      const r = m.run(answer);
      expect(r.code).not.toBe(0);
      expect(r.out).toContain("brew install gh");
      expect(m.calls().filter((c) => c.startsWith("brew"))).toEqual([]);
      expect(m.started()).toEqual([]);
    }
  });

  it("without Homebrew, installs the official release binary in ~/.local/bin and uses it", () => {
    const m = setUp({ gh: false, brew: false });
    const r = m.run("o\n");
    expect(r.code).toBe(0);
    expect(fs.existsSync(path.join(m.home, ".local/bin/gh"))).toBe(true);
    expect(m.calls().some((c) => c.endsWith(`https://github.com/cli/cli/releases/download/v${GH_VERSION}/${GH_ZIP}`))).toBe(true);
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_active DESK_COMMIT=inconnue"]);
    expect(r.out).toContain('export PATH="$HOME/.local/bin:$PATH"');
  });

  it("refuses a downloaded gh whose checksum does not match", () => {
    const m = setUp({ gh: false, brew: false, badChecksum: true });
    const r = m.run("o\n");
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("somme de contrôle");
    expect(fs.existsSync(path.join(m.home, ".local/bin/gh"))).toBe(false);
    expect(m.started()).toEqual([]);
  });
});

describe("start.sh and the GitHub login", () => {
  const withOrigin = (project: string, url: string) => {
    for (const args of [["init", "-q"], ["remote", "add", "origin", url]]) {
      expect(spawnSync("git", ["-C", project, ...args]).status).toBe(0);
    }
  };

  it("explains the browser login, then runs gh auth login on Enter and carries on", () => {
    const m = setUp({ ghLoggedIn: false });
    const r = m.run("\n");
    expect(r.code).toBe(0);
    expect(r.out).toContain("gh ouvre github.com dans ton navigateur");
    expect(r.out).toContain("Me connecter à GitHub ? [O/n]");
    expect(m.calls()).toContain("gh auth login --hostname github.com --web --git-protocol https");
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_active DESK_COMMIT=inconnue"]);
  });

  it("on no, does not open the GitHub login and says what to run", () => {
    const m = setUp({ ghLoggedIn: false });
    const r = m.run("n\n");
    expect(r.code).toBe(1);
    expect(m.calls().some((c) => c.startsWith("gh auth login"))).toBe(false);
    expect(r.err.trim().split("\n").pop()).toBe("✗ Sans connexion GitHub, le Desk ne voit pas tes PR. Lance « gh auth login », puis relance ./start.sh.");
    expect(m.started()).toEqual([]);
  });

  it("stops when the login fails", () => {
    const m = setUp({ ghLoggedIn: false, ghLoginFails: true });
    const r = m.run("\n");
    expect(r.code).not.toBe(0);
    expect(m.calls()).toContain("gh auth login --hostname github.com --web --git-protocol https");
    expect(r.out).toContain("gh auth login");
    expect(m.started()).toEqual([]);
  });

  it("asks again after an answer it does not know, instead of taking it as no", () => {
    const m = setUp({ ghLoggedIn: false });
    const r = m.run("0\no\n");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Réponds o (oui) ou n (non).");
    expect(m.calls()).toContain("gh auth login --hostname github.com --web --git-protocol https");
  });

  it("ignores spaces around the answer", () => {
    const m = setUp({ ghLoggedIn: false });
    expect(m.run(" O \n").code).toBe(0);
    expect(m.calls()).toContain("gh auth login --hostname github.com --web --git-protocol https");
  });

  it("takes an unknown answer followed by no more input as no", () => {
    const m = setUp({ ghLoggedIn: false });
    const r = m.run("0\n");
    expect(r.code).toBe(1);
    expect(m.calls().some((c) => c.startsWith("gh auth login"))).toBe(false);
  });

  it.each(["git@github.com:Villeco-inc/pr-review-desk.git", "ssh://git@github.com/Villeco-inc/pr-review-desk.git"])(
    "with a clone over SSH (%s), keeps SSH and asks nothing about git or SSH keys",
    (url) => {
      const m = setUp({ ghLoggedIn: false });
      withOrigin(m.project, url);
      const r = m.run("\n");
      expect(r.code).toBe(0);
      expect(m.calls()).toContain("gh auth login --hostname github.com --web --git-protocol ssh --skip-ssh-key");
      expect(r.out).not.toContain("configurer Git");
    }
  );

  it("with a clone over HTTPS, keeps HTTPS and warns that gh will offer to set up git", () => {
    const m = setUp({ ghLoggedIn: false });
    withOrigin(m.project, "https://github.com/Villeco-inc/pr-review-desk.git");
    const r = m.run("\n");
    expect(r.code).toBe(0);
    expect(m.calls()).toContain("gh auth login --hostname github.com --web --git-protocol https");
    expect(r.out).toContain("gh te demandera aussi s'il doit configurer Git avec ce compte");
  });

  it("with an origin outside GitHub, keeps the protocol gh already has", () => {
    const m = setUp({ ghLoggedIn: false });
    withOrigin(m.project, "/Users/someone/depot-local.git");
    fs.writeFileSync(path.join(m.state, "gh-git-protocol"), "ssh\n");
    expect(m.run("\n").code).toBe(0);
    expect(m.calls()).toContain("gh auth login --hostname github.com --web --git-protocol ssh --skip-ssh-key");
  });
});

describe("start.sh and the Claude token", () => {
  it("creates .env with only the pasted token, without echoing it, and asks nothing next time", () => {
    const m = setUp({ env: null });
    const r = m.run("\nsk-ant-oat01-pasted\n");
    expect(r.code).toBe(0);
    expect(m.calls()).toContain("claude setup-token");
    expect(m.readEnv()).toBe("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-pasted\n");
    expect(r.out).not.toContain("sk-ant-oat01-pasted");
    expect(fs.statSync(path.join(m.project, ".env")).mode & 0o077).toBe(0);

    const again = m.run();
    expect(again.code).toBe(0);
    expect(m.calls().filter((c) => c === "claude setup-token")).toHaveLength(1);
  });

  it("adds one line to an existing .env and leaves the other lines alone", () => {
    const m = setUp({ env: "REPOS_ROOT=/Users/danngossinga/workspace\n# HOST_PORT=37703\n" });
    expect(m.run("\nsk-ant-oat01-pasted\n").code).toBe(0);
    expect(m.readEnv()).toBe("REPOS_ROOT=/Users/danngossinga/workspace\n# HOST_PORT=37703\nCLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-pasted\n");
  });

  it("fills an empty CLAUDE_CODE_OAUTH_TOKEN= line in place rather than adding a second one", () => {
    const m = setUp({ env: "REPOS=Villeco-inc/villeco\nCLAUDE_CODE_OAUTH_TOKEN=\nREPOS_ROOT=/Users/danngossinga/workspace\n" });
    expect(m.run("\nsk-ant-oat01-pasted\n").code).toBe(0);
    expect(m.readEnv()).toBe("REPOS=Villeco-inc/villeco\nCLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-pasted\nREPOS_ROOT=/Users/danngossinga/workspace\n");
  });

  it("keeps trailing blank lines and a last line without newline when filling the empty line", () => {
    const blank = setUp({ env: "CLAUDE_CODE_OAUTH_TOKEN=\nREPOS_ROOT=/x\n\n\n" });
    expect(blank.run("\nsk-ant-oat01-pasted\n").code).toBe(0);
    expect(blank.readEnv()).toBe("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-pasted\nREPOS_ROOT=/x\n\n\n");

    const unterminated = setUp({ env: "CLAUDE_CODE_OAUTH_TOKEN=\n# tail comment" });
    expect(unterminated.run("\nsk-ant-oat01-pasted\n").code).toBe(0);
    expect(unterminated.readEnv()).toBe("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-pasted\n# tail comment");
  });

  it("treats a quoted empty token as missing and fills it in place", () => {
    for (const empty of ['""', "''"]) {
      const m = setUp({ env: `CLAUDE_CODE_OAUTH_TOKEN=${empty}\nREPOS_ROOT=/x\n` });
      expect(m.run("\nsk-ant-oat01-pasted\n").code).toBe(0);
      expect(m.calls()).toContain("claude setup-token");
      expect(m.readEnv()).toBe("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-pasted\nREPOS_ROOT=/x\n");
    }
  });

  it("explains the token before running claude setup-token", () => {
    const m = setUp({ env: null });
    const r = m.run("\nsk-ant-oat01-pasted\n");
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "Le Desk a besoin d'un token Claude pour lancer les reviews. J'ouvre claude.ai dans ton navigateur : connecte-toi et colle le token. Gardé dans .env, sur ce Mac seulement."
    );
    expect(r.out).toContain("Créer le token Claude ? [O/n]");
  });

  it("on no, never runs claude setup-token and says what to do", () => {
    for (const answer of ["n\n", ""]) {
      const m = setUp({ env: "REPOS_ROOT=/x\n" });
      const r = m.run(answer);
      expect(r.code).toBe(1);
      expect(m.calls()).not.toContain("claude setup-token");
      expect(r.err.trim().split("\n").pop()).toBe(
        "✗ Sans token Claude, le Desk ne peut pas lancer de reviews. Relance ./start.sh quand tu es prêt (ou mets le token de « claude setup-token » dans .env : CLAUDE_CODE_OAUTH_TOKEN=…)."
      );
      expect(m.readEnv()).toBe("REPOS_ROOT=/x\n");
      expect(m.started()).toEqual([]);
    }
  });

  it("stops without writing anything when the pasted token is empty", () => {
    const m = setUp({ env: "REPOS_ROOT=/x\n" });
    const r = m.run("\n\n");
    expect(r.code).not.toBe(0);
    expect(m.readEnv()).toBe("REPOS_ROOT=/x\n");
    expect(m.started()).toEqual([]);
  });

  it("installs claude with the official installer when the answer is yes", () => {
    const m = setUp({ claude: false, env: null });
    const r = m.run("\n\nsk-ant-oat01-pasted\n");
    expect(r.code).toBe(0);
    expect(m.calls()).toContain("curl -fsSL https://claude.ai/install.sh");
    expect(m.calls()).toContain("claude setup-token");
    expect(m.readEnv()).toBe("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-pasted\n");
  });

  it("on no, says how to install claude and stops", () => {
    const m = setUp({ claude: false, env: null });
    const r = m.run("\nN\n");
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("curl -fsSL https://claude.ai/install.sh | bash");
    expect(m.started()).toEqual([]);
  });
});

describe("start.sh on a brand-new Mac with only Docker", () => {
  it("installs gh and claude, logs in, takes the Claude token and starts, in one run", () => {
    const m = setUp({ gh: false, claude: false, ghLoggedIn: false, env: null });
    const r = m.run("\n\n\n\nsk-ant-oat01-pasted\n");
    expect(r.code).toBe(0);
    expect(m.calls()).toEqual(
      expect.arrayContaining(["brew install gh", "gh auth login --hostname github.com --web --git-protocol https", "curl -fsSL https://claude.ai/install.sh", "claude setup-token"])
    );
    expect(m.readEnv()).toBe("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-pasted\n");
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_active DESK_COMMIT=inconnue"]);
    expect(r.out).toContain("http://localhost:37703");
  });
});

describe("start.sh on Linux", () => {
  it("offers no install: it prints the commands and stops", () => {
    const m = setUp({ os: "Linux", gh: false, claude: false, env: null });
    const r = m.run("o\no\n");
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("https://github.com/cli/cli/blob/trunk/docs/install_linux.md");
    expect(r.out).toContain("curl -fsSL https://claude.ai/install.sh | bash");
    expect(m.calls().filter((c) => c.startsWith("brew") || c.startsWith("curl"))).toEqual([]);
    expect(m.started()).toEqual([]);
  });

  it("starts like on a Mac once gh and claude are there", () => {
    const m = setUp({ os: "Linux" });
    expect(m.run().code).toBe(0);
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_active DESK_COMMIT=inconnue"]);
  });
});

describe("start.sh and the menu-bar app", () => {
  const FAKE_INSTALL = `#!/bin/sh
echo "tray/install.sh $*" >> "$FAKE_STATE/calls.log"
echo "[3/9] Compiling DeskTray MenuModel.swift"
[ -f "$FAKE_STATE/tray-install-fails" ] && { echo "error: compile failed" >&2; exit 1; }
[ "$2" = "--build-only" ] || [ -f "$FAKE_STATE/tray-wont-start" ] || touch "$FAKE_STATE/tray-running"
exit 0
`;
  const QUESTION = "Installer l'icône près de l'horloge ? [O/n]";
  const LOGIN_QUESTION = "La lancer au démarrage du Mac ? [O/n]";
  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };

  /** A machine whose project is a real clone on main, with a fake tray/install.sh committed in it. */
  function trayMachine(m: Machine = {}) {
    const mm = setUp(m);
    git(mm.project, "init", "-q", "-b", "main");
    git(mm.project, "config", "user.name", "Test");
    git(mm.project, "config", "user.email", "test@example.com");
    git(mm.project, "config", "commit.gpgsign", "false");
    fs.mkdirSync(path.join(mm.project, "tray"));
    fs.writeFileSync(path.join(mm.project, "tray/install.sh"), FAKE_INSTALL, { mode: 0o755 });
    git(mm.project, "add", "tray");
    git(mm.project, "commit", "-q", "-m", "init");
    const here = fs.realpathSync(mm.project);
    const app = path.join(mm.home, "Applications/PR Review Desk.app");
    const config = path.join(mm.home, "Library/Application Support/PR Review Desk/config.json");
    return {
      ...mm,
      here,
      installCalls: () => mm.calls().filter((c) => c.startsWith("tray/install.sh")),
      declined: () => fs.existsSync(path.join(mm.project, ".desk/tray-declined")),
      /** The app is installed, attached to `clonePath` and built from the tray tree `trayTree`. */
      install: (clonePath = here, trayTree = git(mm.project, "rev-parse", "HEAD:tray"), compact = false) => {
        fs.mkdirSync(app, { recursive: true });
        fs.mkdirSync(path.dirname(config), { recursive: true });
        fs.writeFileSync(
          config,
          compact
            ? `{"clonePath":"${clonePath}","trayTree":"${trayTree}"}`
            : `{\n  "clonePath" : "${clonePath}",\n  "trayTree"  :   "${trayTree}"\n}\n`
        );
      },
      changeTray: () => {
        fs.appendFileSync(path.join(mm.project, "tray/install.sh"), "# changed\n");
        git(mm.project, "commit", "-qam", "change tray");
      },
    };
  }

  it("explains the icon, then on Enter compiles it, asks about launch at login and installs it with launch at login", () => {
    const m = trayMachine();
    const r = m.run("\n\n");
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "une icône près de l'horloge : elle démarre le Desk avec le Mac, montre s'il tourne, l'ouvre et le met à jour en un clic, et lance une review depuis un lien de PR copié."
    );
    expect(r.out).toContain(QUESTION);
    expect(r.out.indexOf("Compilation de l'icône…")).toBeLessThan(r.out.indexOf(LOGIN_QUESTION));
    expect(m.installCalls()).toEqual([`tray/install.sh ${m.here} --build-only`, `tray/install.sh ${m.here} --login`]);
    expect(r.out).toContain("✓ Barre de menus : démarrée · au démarrage du Mac");
    expect(r.out).toMatch(/✨ C'est prêt\n\s*http:\/\/localhost:37703\n\s*Ou clique l'icône en haut à droite\.\n/);
    expect(r.out).toContain("copie un lien de PR, puis ouvre le menu");
    expect(r.out).toContain("« Lancer au démarrage du Mac »");
    expect(m.started()).toHaveLength(1);
    expect(m.declined()).toBe(false);
  });

  it("installs without launch at login on no", () => {
    const m = trayMachine();
    const r = m.run("\nn\n");
    expect(r.code).toBe(0);
    expect(m.installCalls()).toEqual([`tray/install.sh ${m.here} --build-only`, `tray/install.sh ${m.here} --no-login`]);
    expect(r.out).toContain("✓ Barre de menus : démarrée\n");
  });

  it("writes install.sh's output to the log, not to the terminal", () => {
    const m = trayMachine();
    const r = m.run("\n\n");
    expect(r.out).not.toContain("Compiling DeskTray");
    expect(fs.readFileSync(path.join(m.project, ".desk/start.log"), "utf8")).toContain("[3/9] Compiling DeskTray MenuModel.swift");
  });

  it("says plainly when the icon does not start, without a ✗ line", () => {
    const m = trayMachine();
    fs.writeFileSync(path.join(m.state, "tray-wont-start"), "");
    const r = m.run("\n\n");
    expect(r.code).toBe(0);
    expect(r.err).toContain("⚠ L'icône ne s'est pas lancée. Ouvre « PR Review Desk » dans ~/Applications, ou relance ./start.sh --tray.");
    expect(r.out).not.toContain("démarrée");
    expect(r.out).not.toContain("✗");
  });

  it("remembers a no and does not ask again", () => {
    const m = trayMachine();
    expect(m.run("N\n").code).toBe(0);
    expect(m.declined()).toBe(true);
    const again = m.run("o\n");
    expect(again.out).not.toContain(QUESTION);
    expect(m.installCalls()).toEqual([]);
    expect(m.started()).toHaveLength(2);
  });

  it("with --tray after a refusal, installs without asking whether to (only about launch at login) and forgets the refusal", () => {
    const m = trayMachine();
    m.run("N\n");
    const r = m.run("", ["--tray"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain(QUESTION);
    expect(r.out).toContain(LOGIN_QUESTION);
    expect(m.installCalls()).toEqual([`tray/install.sh ${m.here} --build-only`, `tray/install.sh ${m.here} --no-login`]);
    expect(m.declined()).toBe(false);
  });

  it("rebuilds an installed tray with --tray even when nothing changed", () => {
    const m = trayMachine();
    m.install();
    m.run("", ["--tray"]);
    expect(m.installCalls()).toEqual([`tray/install.sh ${m.here}`]);
  });

  it("asks nothing when the tray is already installed and up to date", () => {
    const m = trayMachine();
    m.install();
    const r = m.run();
    expect(r.out).not.toContain(QUESTION);
    expect(r.out).not.toContain("Mise à jour du tray");
    expect(m.installCalls()).toEqual([]);
    expect(m.started()).toHaveLength(1);
  });

  it("reads config.json whether it sits on one line or several", () => {
    const m = trayMachine();
    m.install(m.here, undefined, true);
    m.run();
    expect(m.installCalls()).toEqual([]);
  });

  it("rebuilds without a question when the fingerprint of tray/ changed", () => {
    const m = trayMachine();
    m.install();
    m.changeTray();
    const r = m.run();
    expect(r.out).toContain("Mise à jour du tray…");
    expect(r.out).not.toContain("[O/n]");
    expect(r.out).not.toContain(LOGIN_QUESTION);
    expect(m.installCalls()).toEqual([`tray/install.sh ${m.here}`]);
    expect(r.out).toContain("✓ Barre de menus : mise à jour · démarrée");
    expect(m.started()).toHaveLength(1);
  });

  it("does not call install.sh when the fingerprint is identical", () => {
    const m = trayMachine();
    m.install();
    fs.writeFileSync(path.join(m.project, "README.md"), "other change\n");
    git(m.project, "add", "README.md");
    git(m.project, "commit", "-qm", "docs");
    m.run();
    expect(m.installCalls()).toEqual([]);
  });

  it("asks for the Command Line Tools, installs them, waits, then installs the tray", () => {
    const m = trayMachine({ clt: "missing" });
    const r = m.run("o\no\n");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Les Command Line Tools de Xcode servent à compiler l'icône sur ce Mac.");
    expect(r.out).toContain("Installer les Command Line Tools ? [O/n]");
    expect(r.out).toContain("En attente de la fin de l'installation des Command Line Tools…");
    const calls = m.calls();
    expect(calls).toContain("xcode-select --install");
    expect(calls.indexOf("xcode-select --install")).toBeLessThan(calls.findIndex((c) => c.startsWith("tray/install.sh")));
    expect(m.installCalls()).toEqual([`tray/install.sh ${m.here} --build-only`, `tray/install.sh ${m.here} --no-login`]);
    expect(m.started()).toHaveLength(1);
  });

  it("skips the tray for this run on no to the Command Line Tools, without remembering a refusal", () => {
    const m = trayMachine({ clt: "missing" });
    const r = m.run("o\nN\n");
    expect(r.code).toBe(0);
    expect(m.calls()).not.toContain("xcode-select --install");
    expect(m.installCalls()).toEqual([]);
    expect(m.declined()).toBe(false);
    expect(m.started()).toHaveLength(1);
  });

  it("gives up with a warning when the Command Line Tools never arrive, and still starts the Desk", () => {
    const m = trayMachine({ clt: "never" });
    const r = m.run("o\no\n");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/⚠.*Command Line Tools/);
    expect(m.installCalls()).toEqual([]);
    expect(m.declined()).toBe(false);
    expect(m.started()).toHaveLength(1);
  });

  it("installs the tray only once the Desk is up, so a new tray never races the build", () => {
    const m = trayMachine();
    const r = m.run("o\n");
    expect(r.code).toBe(0);
    const calls = m.calls();
    const up = calls.findIndex((c) => c.startsWith("docker compose up -d --build"));
    const install = calls.findIndex((c) => c.startsWith("tray/install.sh"));
    expect(up).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThan(up);
    expect(r.out.indexOf("✓ Desk : http://localhost:37703")).toBeLessThan(r.out.indexOf(QUESTION));
  });

  it("does not install the tray when docker compose up fails", () => {
    const m = trayMachine();
    fs.writeFileSync(path.join(m.state, "compose-fails"), "");
    const r = m.run("o\n", ["--tray"]);
    expect(r.code).toBe(1);
    expect(r.out.trim().split("\n").pop()).toBe("✗ docker compose up a échoué.");
    expect(m.installCalls()).toEqual([]);
  });

  it("skips the tray with the update advice when the Command Line Tools ship a Swift older than 6", () => {
    const m = trayMachine({ swift: "5.10" });
    const r = m.run("o\n");
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "⚠ Les Command Line Tools de Xcode sont trop anciennes pour construire le tray (Swift 6 requis) : xcode-select --install, ou mets-les à jour dans Réglages Système > Mise à jour de logiciels. Le tray est sauté pour ce lancement."
    );
    expect(m.calls()).not.toContain("xcode-select --install");
    expect(m.installCalls()).toEqual([]);
    expect(m.declined()).toBe(false);
    expect(m.started()).toHaveLength(1);
  });

  it("builds the tray with Swift 6", () => {
    const m = trayMachine({ swift: "6.0" });
    m.run("o\no\n");
    expect(m.installCalls()).toEqual([`tray/install.sh ${m.here} --build-only`, `tray/install.sh ${m.here} --login`]);
  });

  it("warns, without a ✗ line, when install.sh fails, and still starts the Desk", () => {
    const m = trayMachine();
    fs.writeFileSync(path.join(m.state, "tray-install-fails"), "");
    const r = m.run("o\n");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/⚠.*tray/);
    expect(r.err).toContain("error: compile failed");
    expect(r.out).not.toContain("✗");
    expect(m.started()).toHaveLength(1);
  });

  it("refuses --tray on a branch other than main, naming it", () => {
    const m = trayMachine();
    git(m.project, "checkout", "-q", "-b", "feat/autre");
    const r = m.run("", ["--tray"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Le tray s'installe depuis le clone principal, sur main (ici : feat/autre).");
    expect(m.installCalls()).toEqual([]);
    expect(m.started()).toEqual([]);
  });

  it("skips the step without --tray on another branch: no question, the Desk starts", () => {
    const m = trayMachine();
    git(m.project, "checkout", "-q", "-b", "feat/autre");
    const r = m.run("o\n");
    expect(r.code).toBe(0);
    expect(r.out).not.toContain(QUESTION);
    expect(m.installCalls()).toEqual([]);
    expect(m.started()).toHaveLength(1);
  });

  it("refuses --tray from a worktree, and does nothing there without it", () => {
    const m = trayMachine();
    const wt = path.join(m.root, "wt");
    git(m.project, "worktree", "add", "-q", "-b", "autre", wt);
    fs.copyFileSync(path.join(m.project, "start.sh"), path.join(wt, "start.sh"));
    fs.copyFileSync(path.join(m.project, ".env"), path.join(wt, ".env"));
    const refused = m.run("", ["--tray"], wt);
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("Le tray s'installe depuis le clone principal, sur main (ici : worktree");
    expect(refused.out).toContain(fs.realpathSync(wt));
    const quiet = m.run("o\n", [], wt);
    expect(quiet.code).toBe(0);
    expect(quiet.out).not.toContain(QUESTION);
    expect(m.installCalls()).toEqual([]);
  });

  it("shows the other clone the tray is attached to and asks before re-attaching it", () => {
    const m = trayMachine();
    m.install("/Users/autre/pr-review-desk");
    const r = m.run("o\n");
    expect(r.out).toContain("/Users/autre/pr-review-desk");
    expect(r.out).toContain("Rattacher le tray à ce clone-ci ? [o/N]");
    expect(m.installCalls()).toEqual([`tray/install.sh ${m.here}`]);

    const refused = trayMachine();
    refused.install("/Users/autre/pr-review-desk");
    const r2 = refused.run("N\n");
    expect(r2.code).toBe(0);
    expect(refused.installCalls()).toEqual([]);
    expect(refused.started()).toHaveLength(1);
  });

  it("remembers a no to re-attaching the tray, and asks again only with --tray", () => {
    const m = trayMachine();
    m.install("/Users/autre/pr-review-desk");
    expect(m.run("N\n").out).toContain("Rattacher le tray à ce clone-ci ? [o/N]");
    const again = m.run("o\n");
    expect(again.code).toBe(0);
    expect(again.out).not.toContain("Rattacher");
    expect(m.installCalls()).toEqual([]);
    expect(m.run("o\n", ["--tray"]).out).toContain("Rattacher le tray à ce clone-ci ? [o/N]");
    expect(m.installCalls()).toEqual([`tray/install.sh ${m.here}`]);
  });

  it("still offers the icon to a clone that kept the tray on another one, once that tray is uninstalled", () => {
    const m = trayMachine();
    m.install("/Users/autre/pr-review-desk");
    m.run("N\n");
    expect(m.declined()).toBe(false);
    fs.rmSync(path.join(m.home, "Applications/PR Review Desk.app"), { recursive: true });
    expect(m.run("n\n").out).toContain("Installer l'icône près de l'horloge ? [O/n]");
  });

  it("with --tray also asks before moving a tray attached to another clone", () => {
    const no = trayMachine();
    no.install("/Users/autre/pr-review-desk");
    fs.mkdirSync(path.join(no.project, ".desk"));
    fs.writeFileSync(path.join(no.project, ".desk/tray-declined"), "");
    const r = no.run("N\n", ["--tray"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("/Users/autre/pr-review-desk");
    expect(r.out).toContain("Rattacher le tray à ce clone-ci ? [o/N]");
    expect(no.installCalls()).toEqual([]);
    expect(no.declined()).toBe(true);
    expect(no.started()).toHaveLength(1);

    const yes = trayMachine();
    yes.install("/Users/autre/pr-review-desk");
    yes.run("o\n", ["--tray"]);
    expect(yes.installCalls()).toEqual([`tray/install.sh ${yes.here}`]);
  });

  it("un-escapes the slashes Swift's JSONEncoder writes in config.json", () => {
    const m = trayMachine();
    m.install();
    const config = path.join(m.home, "Library/Application Support/PR Review Desk/config.json");
    const escaped = m.here.replaceAll("/", "\\/");
    fs.writeFileSync(config, `{"clonePath" : "${escaped}", "trayTree" : "${git(m.project, "rev-parse", "HEAD:tray")}"}`);
    const r = m.run();
    expect(r.out).not.toContain("Rattacher");
    expect(m.installCalls()).toEqual([]);
  });

  it("rebuilds when the app is there but config.json is missing", () => {
    const m = trayMachine();
    m.install();
    fs.rmSync(path.join(m.home, "Library"), { recursive: true });
    const r = m.run();
    expect(r.out).toContain("Mise à jour du tray…");
    expect(m.installCalls()).toEqual([`tray/install.sh ${m.here}`]);
  });

  it("does nothing on Linux", () => {
    const m = trayMachine({ os: "Linux" });
    const r = m.run("o\n", ["--tray"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("barre de menus");
    expect(m.installCalls()).toEqual([]);
  });

  it("does nothing without tray/install.sh", () => {
    const m = trayMachine();
    git(m.project, "rm", "-q", "-r", "tray");
    const r = m.run("o\n", ["--tray"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("barre de menus");
    expect(m.started()).toHaveLength(1);
  });

  it("with --no-prompt skips the whole step, rebuild included", () => {
    const fresh = trayMachine();
    const r = fresh.run("o\n", ["--no-prompt"]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("barre de menus");
    expect(fresh.installCalls()).toEqual([]);
    expect(fresh.declined()).toBe(false);

    const stale = trayMachine();
    stale.install();
    stale.changeTray();
    const r2 = stale.run("o\n", ["--no-prompt", "--tray"]);
    expect(r2.code).toBe(0);
    expect(r2.out).not.toContain("Mise à jour du tray");
    expect(stale.installCalls()).toEqual([]);
    expect(stale.started()).toHaveLength(1);
  });
});
