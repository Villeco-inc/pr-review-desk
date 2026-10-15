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
if [ "$1" = "compose" ]; then echo "docker $* GH_TOKEN=$GH_TOKEN" >> "$FAKE_STATE/calls.log"; else echo "docker $*" >> "$FAKE_STATE/calls.log"; fi
exit 0
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
  docker?: "running" | "stopped" | "missing";
  env?: string | null;
  badChecksum?: boolean;
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
  if ((m.docker ?? "running") !== "missing") write(bin, "docker", FAKES.docker);
  if (m.docker === "stopped") fs.writeFileSync(path.join(state, "docker-down"), "");
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

  const run = (input = "", args: string[] = []) => {
    const r = spawnSync("/bin/bash", [path.join(project, "start.sh"), ...args], {
      cwd: root,
      input,
      encoding: "utf8",
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, FAKE_STATE: state, FAKE_BIN: bin, FAKE_OS: m.os ?? "Darwin" },
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const calls = () => {
    const file = path.join(state, "calls.log");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n") : [];
  };
  const readEnv = () => fs.readFileSync(path.join(project, ".env"), "utf8");
  const started = () => calls().filter((c) => c.startsWith("docker compose"));
  return { run, calls, readEnv, started, project, home };
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
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_active"]);
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
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_autre"]);
  });

  it("rejects an unknown option without starting anything", () => {
    const m = setUp();
    const r = m.run("", ["--nope"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("--user");
    expect(m.started()).toEqual([]);
  });
});

describe("start.sh and Docker", () => {
  it("asks to install Docker Desktop before touching anything else", () => {
    const m = setUp({ docker: "missing", gh: false });
    const r = m.run("o\n");
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Installe Docker Desktop");
    expect(m.calls()).toEqual([]);
  });

  it("asks to start Docker Desktop when it is not running", () => {
    const m = setUp({ docker: "stopped" });
    const r = m.run();
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Démarre Docker Desktop");
    expect(m.started()).toEqual([]);
    expect(m.calls().filter((c) => c.startsWith("gh"))).toEqual([]);
  });
});

describe("start.sh installing gh on a Mac", () => {
  it("installs gh with Homebrew when the answer is yes", () => {
    const m = setUp({ gh: false });
    const r = m.run("o\n");
    expect(r.code).toBe(0);
    expect(m.calls()).toContain("brew install gh");
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_active"]);
  });

  it("installs nothing on no, says how to install it, and stops", () => {
    for (const answer of ["N\n", "\n"]) {
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
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_active"]);
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
  it("runs gh auth login itself when no account is logged in, then carries on", () => {
    const m = setUp({ ghLoggedIn: false });
    const r = m.run();
    expect(r.code).toBe(0);
    expect(m.calls()).toContain("gh auth login --hostname github.com --web");
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_active"]);
  });

  it("stops when the login fails", () => {
    const m = setUp({ ghLoggedIn: false, ghLoginFails: true });
    const r = m.run();
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("gh auth login");
    expect(m.started()).toEqual([]);
  });
});

describe("start.sh and the Claude token", () => {
  it("creates .env with only the pasted token, without echoing it, and asks nothing next time", () => {
    const m = setUp({ env: null });
    const r = m.run("sk-ant-oat01-pasted\n");
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
    expect(m.run("sk-ant-oat01-pasted\n").code).toBe(0);
    expect(m.readEnv()).toBe("REPOS_ROOT=/Users/danngossinga/workspace\n# HOST_PORT=37703\nCLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-pasted\n");
  });

  it("fills an empty CLAUDE_CODE_OAUTH_TOKEN= line in place rather than adding a second one", () => {
    const m = setUp({ env: "REPOS=Villeco-inc/villeco\nCLAUDE_CODE_OAUTH_TOKEN=\nREPOS_ROOT=/Users/danngossinga/workspace\n" });
    expect(m.run("sk-ant-oat01-pasted\n").code).toBe(0);
    expect(m.readEnv()).toBe("REPOS=Villeco-inc/villeco\nCLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-pasted\nREPOS_ROOT=/Users/danngossinga/workspace\n");
  });

  it("keeps trailing blank lines and a last line without newline when filling the empty line", () => {
    const blank = setUp({ env: "CLAUDE_CODE_OAUTH_TOKEN=\nREPOS_ROOT=/x\n\n\n" });
    expect(blank.run("sk-ant-oat01-pasted\n").code).toBe(0);
    expect(blank.readEnv()).toBe("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-pasted\nREPOS_ROOT=/x\n\n\n");

    const unterminated = setUp({ env: "CLAUDE_CODE_OAUTH_TOKEN=\n# tail comment" });
    expect(unterminated.run("sk-ant-oat01-pasted\n").code).toBe(0);
    expect(unterminated.readEnv()).toBe("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-pasted\n# tail comment");
  });

  it("treats a quoted empty token as missing and fills it in place", () => {
    for (const empty of ['""', "''"]) {
      const m = setUp({ env: `CLAUDE_CODE_OAUTH_TOKEN=${empty}\nREPOS_ROOT=/x\n` });
      expect(m.run("sk-ant-oat01-pasted\n").code).toBe(0);
      expect(m.calls()).toContain("claude setup-token");
      expect(m.readEnv()).toBe("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-pasted\nREPOS_ROOT=/x\n");
    }
  });

  it("stops without writing anything when the pasted token is empty", () => {
    const m = setUp({ env: "REPOS_ROOT=/x\n" });
    const r = m.run("\n");
    expect(r.code).not.toBe(0);
    expect(m.readEnv()).toBe("REPOS_ROOT=/x\n");
    expect(m.started()).toEqual([]);
  });

  it("installs claude with the official installer when the answer is yes", () => {
    const m = setUp({ claude: false, env: null });
    const r = m.run("o\nsk-ant-oat01-pasted\n");
    expect(r.code).toBe(0);
    expect(m.calls()).toContain("curl -fsSL https://claude.ai/install.sh");
    expect(m.calls()).toContain("claude setup-token");
    expect(m.readEnv()).toBe("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-pasted\n");
  });

  it("on no, says how to install claude and stops", () => {
    const m = setUp({ claude: false, env: null });
    const r = m.run("N\n");
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("curl -fsSL https://claude.ai/install.sh | bash");
    expect(m.started()).toEqual([]);
  });
});

describe("start.sh on a brand-new Mac with only Docker", () => {
  it("installs gh and claude, logs in, takes the Claude token and starts, in one run", () => {
    const m = setUp({ gh: false, claude: false, ghLoggedIn: false, env: null });
    const r = m.run("o\no\nsk-ant-oat01-pasted\n");
    expect(r.code).toBe(0);
    expect(m.calls()).toEqual(
      expect.arrayContaining(["brew install gh", "gh auth login --hostname github.com --web", "curl -fsSL https://claude.ai/install.sh", "claude setup-token"])
    );
    expect(m.readEnv()).toBe("CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-pasted\n");
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_active"]);
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
    expect(m.started()).toEqual(["docker compose up -d --build GH_TOKEN=gho_active"]);
  });
});
