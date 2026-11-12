# PR Review Desk

A desk for reviewing code with Claude, running on your own machine.

It lists the open pull requests of your GitHub repositories, runs a Claude Code review on any of them, and lets you post the findings back to GitHub as inline comments — one by one, after you have read and edited them. It can also review a **local branch** before you open a PR, and keeps a full record of every review session: the prompt, everything the agent said, and what it cost.

## What you need

On a Mac: **Docker Desktop**, running, plus a **GitHub** account and a **Claude** plan. `./start.sh` installs the rest when you say yes.

On Linux: Docker with Compose v2, plus `gh` and `claude` installed by hand (see [Linux](#linux)).

## Install

```bash
git clone https://github.com/davidrlarochelle/pr-review-desk.git
cd pr-review-desk
./start.sh
```

The first run walks you through everything, and stops with the exact command to run if you answer no:

1. Checks that Docker is installed and running, and that the app's port (37703 unless `HOST_PORT` says otherwise) is free. Restarting this same install is fine: its own container may hold the port.
2. Installs the GitHub CLI (`gh`) if it is missing: with Homebrew when you have it, otherwise the official release from GitHub, checked against its checksum and put in `~/.local/bin`.
3. Logs you in to GitHub (`gh auth login`, in your browser) if you are not logged in yet.
4. Installs Claude Code (`claude`) with its official installer if it is missing, runs `claude setup-token` and asks you to paste the token. It is saved in `.env`, and nothing else is written there.
5. Builds and starts the app, and prints its address: **http://localhost:37703**.

On the first visit, the app asks which repositories to follow, among every repository your GitHub account can see. Change them later from **Repositories** in the left rail, or `⌘K` → *Pick repositories*.

The GitHub token is read from `gh` at every start and handed to the container. It is never written to a file. To use another account gh is logged in to: `./start.sh --user <login>`.

### Linux

`./start.sh` checks the same things but does not install anything. Install the two tools first, then run it:

```bash
# GitHub CLI: https://github.com/cli/cli/blob/trunk/docs/install_linux.md
curl -fsSL https://claude.ai/install.sh | bash    # Claude Code
./start.sh
```

## Which repositories (optional)

Point the app at the folder where your checkouts live. Docker mounts it read-only at `/repos`.

```bash
REPOS_ROOT=/Users/me/code    # absolute path, defaults to ~/Documents
SCAN_DIR=my-org              # relative to REPOS_ROOT: /Users/me/code/my-org/<each repo>
```

Every subfolder of `SCAN_DIR` with a `.git` becomes a local repo, named after its folder, in **Local branches**. The folder is read again every 30 seconds: clone a repo there and it appears, no restart. Until you pick repositories in the app, the GitHub repo of each one's `origin` also joins the PR list. Hidden folders, worktrees and folders without a GitHub `origin` are left out of it.

For checkouts outside that folder, add them by hand: `LOCAL_REPOS=label=relative/path,…`.

### Reviewing local branches

The review compares **commits**: `base...branch` in that checkout. Work that is not committed yet, or that only lives in another worktree, is not part of the diff. An empty diff gives a review with no findings.

## All settings

| Variable | Required | Default | What it does |
| --- | --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | yes | — | Runs `claude -p` inside the container. Written by `./start.sh` |
| `REPOS` | no | none | Starting pick of repositories for an existing install, until you pick them in the app |
| `GH_TOKEN` | no | from `gh` | Lists PRs and posts comments **as you**. `./start.sh` sets it; only needed in `.env` to start with `docker compose up` directly |
| `REPOS_ROOT` | no | `~/Documents` | Folder with your local checkouts |
| `SCAN_DIR` | no | none | Folder of checkouts, relative to `REPOS_ROOT`, scanned for repos |
| `LOCAL_REPOS` | no | none | Extra local checkouts, `label=relative/path,…` |
| `DEADPOOL_REVIEWS_DIR` | no | `~/.cerebro/revues` | Deadpool's verdict files; their findings show up on the local review of each branch |
| `HOST_PORT` | no | `37703` | Port the app is served on |
| `PORT` | no | `3100` | Port of the server in dev mode |
| `TYPESAFE_API_KEY` | no | none | Turns on Jev: each new finding is judged (nit, severity, does it hold) and Activity compares the answers with what you posted or dismissed. **The text of every finding is sent to TypeSafe** |
| `JEV_MODEL` | no | `jev-1.13.0` | Jev model; pinned so stored probabilities stay comparable |

## Using it

- **Pull requests**: pick a repository (or **All selected repos**), filter by author, status or label, open a PR, choose a model and an effort level, then **Start review**. Findings arrive sorted by severity.
- **Always fresh**: while the app is open, the server asks GitHub for your repositories' pull requests every 90 seconds, and once at startup. The line under the title says how long ago that was, and says so when the last refresh failed. **Refresh** asks GitHub right away. After 10 minutes without a visit it slows down to one refresh every 30 minutes, and a page opened or come back to after a while refreshes at once.
- **Findings**: each one shows the background, the problem and a suggested fix, next to the diff. Edit the suggested comment, then post it inline or as a PR comment, or dismiss it.
- **Local branches**: pick a checkout, a branch and a base, then review. You get a **Copy fix prompt** to hand the findings to your coding agent.
- **Deadpool**: when the folder `DEADPOOL_REVIEWS_DIR` exists, every verdict file Deadpool writes there (`<ticket>/<date>-<dev>-tour<n>-<verdict>.md`) is read every 30 seconds. Its findings join the local review of the reviewed branch, in the repo whose history holds the reviewed commit, marked **Deadpool**, and you treat them like any other finding. A later round marks the open findings of the earlier ones resolved, since Deadpool lists again every finding that still holds. The files are only read; a verdict whose commit is in none of your local repos is left out, and the server log says so.
- **Sessions**: the **Session** button on a review shows the latest run of the agent: model, turns, duration, tokens, cost, the full prompt and every event it streamed. Earlier runs are one click away.
- **Every screen has its own URL**. Refresh, Back and Forward work, and each list remembers your last repository and that repository's filters.
- **Look**: switch between two design systems (Brutal, Blueprint), in light or dark, at the bottom of the left rail.

### Keyboard

| Where | Keys |
| --- | --- |
| Anywhere | `⌘K` / `Ctrl+K` jump to a PR, branch or finding, or pick repositories |
| PR list, local branches | `J` / `K` move, `Enter` open, `R` start a review |
| PR detail | `X` select the focused finding, `P` post the selection, `Esc` back |
| Finding | `J` / `K` next / previous finding, `Esc` back |

### Models and effort

Model: Sonnet, Opus, Haiku or Fable. Effort caps the agent's turns: Quick 1, Standard 3, Thorough 10, Exhaustive 25. Your last choice is remembered.

## Cost

Every review runs on **your** Claude plan. For reference, reviews of real PRs with Opus cost between $0.15 and $0.32 each; the Session screen shows the exact figure for every run.

## Your data

Everything lives in `./data`, next to the code, and survives rebuilds:

- `data/reviews.db` — SQLite: reviews, findings, cached PR lists, runs, the repositories you follow.
- `data/runs/<run id>/` — for each run: `prompt.txt`, `stream.jsonl` (the raw events), `stderr.log`.

To start from scratch: `docker compose down`, delete `data/`, start again.

## Updating

```bash
git pull
./start.sh
```

Nothing to migrate by hand: the database schema is completed at startup.

## Security

- The app is served on `127.0.0.1` only. It holds your GitHub token and posts comments in your name, so it must not be reachable from the network.
- `.env` holds your Claude token and is git-ignored. Never commit it. It is not copied into the Docker image.
- Local checkouts are mounted read-only.
- The server answers only requests addressed to `localhost`, and refuses changes sent by any other website open in your browser.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `docker compose up` stops with `CLAUDE_CODE_OAUTH_TOKEN is not set in .env` | Start with `./start.sh`: it asks for the token |
| `./start.sh` stops | It prints why and the command to run. Fix that, then run `./start.sh` again |
| PR list says *GitHub is not authenticated* | The token is missing or expired. Run `./start.sh` again: it reads a fresh token from `gh`, and logs you in if needed |
| The PR list is missing a repository | Add it from **Repositories** in the left rail |
| A review fails right away | Open its **Session**: the stderr panel shows the Claude error. Usually `CLAUDE_CODE_OAUTH_TOKEN` is missing or expired: delete its line in `.env`, then run `./start.sh` |
| Local branches list is empty | `SCAN_DIR` and `LOCAL_REPOS` are empty, or its paths are wrong relative to `REPOS_ROOT` |
| A local review finds nothing | The branch has no commits beyond its base. Commit the work first (see [Reviewing local branches](#reviewing-local-branches)) |
| `./start.sh` says the port is already in use | Another app holds it, often a second install of pr-review-desk. Add the `HOST_PORT=…` it suggests to `.env`, then run `./start.sh` again |

Logs: `docker compose logs -f app`.

## Developing

Needs Node 22.22.3 or later, plus `gh` and `claude` installed on your machine, since the server calls them directly. The end-to-end tests need Node 24 (`.nvmrc`: `nvm use`). After switching Node versions, run `npm rebuild better-sqlite3`: its native module is built for one version.

```bash
npm install
npm run dev             # server on :3100, client on http://localhost:5173
npm test
```

In dev mode the server calls your own `gh` and `claude`, so their logins are used; it reads `.env` (if any) for the optional settings and uses your checkouts in place, from `REPOS_ROOT`. It uses the same `./data` folder as the container, so stop one before starting the other.

### End-to-end tests

The user flows run in a browser with [e2e](https://e2e.tester.army/docs/quickstart.md), against a closed world: fake `gh` and `claude` (`e2e/harness/bin/`) answer from `e2e/fixtures/`, so no test reaches GitHub or a model through the app, and nothing is ever posted. The GitHub poller gets its answers from the same fake `gh`, and the server starts without `TYPESAFE_API_KEY`, so Jev stays off. Each run starts the production build on port 3203 with a fresh database in a temporary folder, deleted at the end.

```bash
npm run test:e2e        # builds, then runs every flow (Node 24)
npx e2e run e2e/tests/findings.e2e.ts --headed   # one file, in a visible browser
```

- **Agent steps.** `agent.act` moves through the app (Anthropic, token from `ant auth print-credentials --profile e2e`; another profile with `E2E_ANT_PROFILE`). Every step is replayed from `.e2e/cache/`, which is committed: a run that changes nothing makes no model call.
- **Add a flow.** Write it as a function in `e2e/flows.ts` and register it in a file under `e2e/tests/`. Start with `resetWorld()`, follow each `agent.act` with an `expect` on the screen (that is what lets the cache record it), and check everything in code: `expect` on the screen, the database and the fake CLIs' journals through `e2e/harness/world-state.ts` (`ghWrites()` is what would have reached GitHub). Never `agent.assert`: it calls the model on every run. Match texts with `/…/i`, since two design systems print them in capitals. New PRs, diffs or review reports go in `e2e/fixtures/`.
- **Refresh the cache.** After a UI change, run `npm run test:e2e`: steps that no longer replay are done again by the agent and recorded. Commit what changed under `.e2e/cache/`. `npx e2e cache ls` lists the entries, `npx e2e cache clear` starts over.
- **When it fails.** Each failed test has a trace page under `.e2e/results/`, the server log is in `.e2e/logs/app.log`, and `E2E_KEEP_WORLD=1` keeps the world folder (database, journals) after the run.
- **Cost.** After each `npm run test:e2e`, a line gives the run's model calls and their estimated cost (`9 tests · 0 appel · 0,000 $`), with the steps that called the model, and is added to `.e2e/cost-history.jsonl`. `npm run e2e:cost` computes it again on the last report (`-- --report <file>` for another one).
- **Ceiling.** `E2E_MAX_USD` (default 1.00) makes the run fail when its estimated cost goes over it. Prices are fixed at the top of `e2e/harness/cost.mjs`: a model missing there fails the calculation rather than counting as free.
- **Billed cost.** The figure is an estimate from the tokens reported. The amount actually billed is in the Anthropic console, under the `e2e` workspace (the one of the `ant` profile).
- **CI.** `.github/workflows/e2e.yml` replays the cache with `--strict-cache`: no model call and no secret. The job summary shows the cost, and one model call fails the job. A stale step fails with `REPLAY_STALE`; refresh the cache locally.

### How it is built

Express and SQLite on the server, React and Vite in the client, TanStack Router for the URLs. The server shells out to `gh` for everything GitHub and to `claude -p --output-format stream-json` for reviews, then parses the JSON report the agent ends with into findings.

| Path | What is there |
| --- | --- |
| `server/src/services/review-engine.ts` | Builds the prompt, runs Claude, imports findings |
| `server/src/services/run-log.ts` | Records every run (the Session screen) |
| `server/src/services/github.ts`, `local-git.ts` | GitHub and local git access |
| `client/src/router.tsx` | Every screen and its URL |
| `client/src/index.css` | Both design systems; see `docs/redesign/theming.md` |
