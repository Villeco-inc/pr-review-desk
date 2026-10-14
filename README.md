# PR Review Desk

A desk for reviewing code with Claude, running on your own machine.

It lists the open pull requests of your GitHub repositories, runs a Claude Code review on any of them, and lets you post the findings back to GitHub as inline comments — one by one, after you have read and edited them. It can also review a **local branch** before you open a PR, and keeps a full record of every review session: the prompt, everything the agent said, and what it cost.

## What you need

- **Docker** with Compose v2 (Docker Desktop is enough).
- **The GitHub CLI**, logged in: `gh auth login`. Only used once, to get a token.
- **Claude Code**, logged in: `claude`. Only used once, to get a token.

The app runs in a container that cannot see the logins on your machine. It only sees the two tokens you put in `.env`.

## Install

```bash
git clone https://github.com/davidrlarochelle/pr-review-desk.git
cd pr-review-desk
cp .env.example .env
```

Fill in `.env`:

| Variable | How to get it |
| --- | --- |
| `REPOS_ROOT` + `SCAN_DIR` | The folder holding your checkouts: every repo cloned there is picked up, see [Which repositories](#which-repositories) |
| `GH_TOKEN` | `gh auth token` |
| `CLAUDE_CODE_OAUTH_TOKEN` | `claude setup-token` (a long-lived token, made for headless use) |

Then:

```bash
docker compose up -d --build
```

Open **http://localhost:37703**.

If a required value is missing, `docker compose up` stops and names it, instead of starting an app that cannot work.

## Which repositories

Point the app at the folder where your checkouts live. Docker mounts it read-only at `/repos`.

```bash
REPOS_ROOT=/Users/me/code    # absolute path, defaults to ~/Documents
SCAN_DIR=my-org              # relative to REPOS_ROOT: /Users/me/code/my-org/<each repo>
```

Every subfolder of `SCAN_DIR` with a `.git` becomes a local repo, named after its folder, and the GitHub repo of its `origin` remote joins the pull request list. The folder is read again every 30 seconds: clone a repo there and it appears, no restart. Hidden folders, worktrees and folders without a GitHub `origin` are left out of the PR list.

For anything outside that folder, add it by hand: `REPOS=owner/name,…` for GitHub repos, `LOCAL_REPOS=label=relative/path,…` for checkouts.

### Reviewing local branches

The review compares **commits**: `base...branch` in that checkout. Work that is not committed yet, or that only lives in another worktree, is not part of the diff. An empty diff gives a review with no findings.

## All settings

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `GH_TOKEN` | yes | — | Lists PRs and posts comments **as you** |
| `CLAUDE_CODE_OAUTH_TOKEN` | yes | — | Runs `claude -p` inside the container |
| `REPOS_ROOT` | no | `~/Documents` | Folder with your local checkouts |
| `SCAN_DIR` | no* | none | Folder of checkouts, relative to `REPOS_ROOT`, scanned for repos |
| `REPOS` | no* | none | Extra GitHub repositories, `owner/name,…` |
| `LOCAL_REPOS` | no | none | Extra local checkouts, `label=relative/path,…` |
| `HOST_PORT` | no | `37703` | Port the app is served on |
| `PORT` | no | `3100` | Port of the server in dev mode |

\* At least one of `SCAN_DIR` or `REPOS`, or the PR list is empty.

## Using it

- **Pull requests**: pick a repository (or all repositories of the org), filter by author, status or label, open a PR, choose a model and an effort level, then **Start review**. Findings arrive sorted by severity.
- **Findings**: each one shows the background, the problem and a suggested fix, next to the diff. Edit the suggested comment, then post it inline or as a PR comment, or dismiss it.
- **Local branches**: pick a checkout, a branch and a base, then review. You get a **Copy fix prompt** to hand the findings to your coding agent.
- **Sessions**: the **Session** button on a review shows the latest run of the agent: model, turns, duration, tokens, cost, the full prompt and every event it streamed. Earlier runs are one click away.
- **Every screen has its own URL**. Refresh, Back and Forward work, and each list remembers your last repository and that repository's filters.
- **Look**: switch between two design systems (Brutal, Blueprint), in light or dark, at the bottom of the left rail.

### Keyboard

| Where | Keys |
| --- | --- |
| Anywhere | `⌘K` / `Ctrl+K` jump to a PR, branch or finding |
| PR list, local branches | `J` / `K` move, `Enter` open, `R` start a review |
| PR detail | `X` select the focused finding, `P` post the selection, `Esc` back |
| Finding | `J` / `K` next / previous finding, `Esc` back |

### Models and effort

Model: Sonnet, Opus, Haiku or Fable. Effort caps the agent's turns: Quick 1, Standard 3, Thorough 10, Exhaustive 25. Your last choice is remembered.

## Cost

Every review runs on **your** Claude plan. For reference, reviews of real PRs with Opus cost between $0.15 and $0.32 each; the Session screen shows the exact figure for every run.

## Your data

Everything lives in `./data`, next to the code, and survives rebuilds:

- `data/reviews.db` — SQLite: reviews, findings, cached PR lists, runs.
- `data/runs/<run id>/` — for each run: `prompt.txt`, `stream.jsonl` (the raw events), `stderr.log`.

To start from scratch: `docker compose down`, delete `data/`, start again.

## Updating

```bash
git pull
docker compose up -d --build
```

Nothing to migrate by hand: the database schema is completed at startup.

## Security

- The app is served on `127.0.0.1` only. It holds your GitHub token and posts comments in your name, so it must not be reachable from the network.
- `.env` holds your tokens and is git-ignored. Never commit it.
- Local checkouts are mounted read-only.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `docker compose up` stops with `GH_TOKEN is not set in .env` (or another variable) | Fill it in `.env`, see [Install](#install) |
| A repository is missing from the lists | Its checkout is not directly under `SCAN_DIR`, or its `origin` is not on GitHub. The server log lists what it found at startup: `docker compose logs app \| grep repos` |
| PR list says *GitHub is not authenticated* | `GH_TOKEN` is empty, wrong or expired. Run `gh auth token`, update `.env`, then `docker compose up -d` |
| A review fails right away | Open its **Session**: the stderr panel shows the Claude error. Usually `CLAUDE_CODE_OAUTH_TOKEN` is missing or expired; run `claude setup-token` again |
| Local branches list is empty | `SCAN_DIR` and `LOCAL_REPOS` are empty, or their paths are wrong relative to `REPOS_ROOT` |
| A local review finds nothing | The branch has no commits beyond its base. Commit the work first (see [Reviewing local branches](#reviewing-local-branches)) |
| Port 37703 is taken | Set `HOST_PORT` in `.env` |

Logs: `docker compose logs -f app`.

## Developing

Needs Node 22.9 or later (`.nvmrc`), plus `gh` and `claude` installed on your machine, since the server calls them directly.

```bash
npm install
cp .env.example .env    # same file as for Docker
npm run dev             # server on :3100, client on http://localhost:5173
npm test
```

In dev mode the server reads `.env` itself and uses your checkouts in place, from `REPOS_ROOT`. It uses the same `./data` folder as the container, so stop one before starting the other.

### How it is built

Express and SQLite on the server, React and Vite in the client, TanStack Router for the URLs. The server shells out to `gh` for everything GitHub and to `claude -p --output-format stream-json` for reviews, then parses the JSON report the agent ends with into findings.

| Path | What is there |
| --- | --- |
| `server/src/services/review-engine.ts` | Builds the prompt, runs Claude, imports findings |
| `server/src/services/run-log.ts` | Records every run (the Session screen) |
| `server/src/services/github.ts`, `local-git.ts` | GitHub and local git access |
| `client/src/router.tsx` | Every screen and its URL |
| `client/src/index.css` | Both design systems; see `docs/redesign/theming.md` |
