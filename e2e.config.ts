import { execFileSync } from "node:child_process";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { E2EConfig } from "e2e";
import { web } from "@e2e-dev/web";
import { APP_URL, PORT, WORLD } from "./e2e/harness/world";

// The model behind agent.act: Anthropic, with the access token of the `ant` CLI's `e2e` profile
// (a workspace of its own with a monthly cap). The token is read on the first model call only,
// so a run that replays everything from .e2e/cache/ never calls `ant` nor the API.
let token: string | undefined;
function accessToken(): string {
  token ??= execFileSync("ant", ["auth", "print-credentials", "--profile", process.env.E2E_ANT_PROFILE ?? "e2e", "--access-token"], {
    encoding: "utf8",
  }).trim();
  return token;
}

const anthropic = createAnthropic({
  apiKey: "unused: the token of the ant profile replaces it",
  fetch: (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("x-api-key");
    headers.set("authorization", `Bearer ${accessToken()}`);
    return fetch(input, { ...init, headers });
  },
});

export default {
  tests: "e2e/tests/**/*.e2e.ts",
  // One world, one database: the flows reset it in turn, so they run one at a time.
  workers: 1,
  // A retry never replays from the cache: a flaky flow should fail, not pay for the model.
  retries: 0,
  targets: [
    {
      name: "desk",
      engine: web(),
      app: {
        url: APP_URL,
        command: {
          executable: process.execPath,
          args: ["e2e/harness/start-app.mjs"],
          env: { PORT: String(PORT), E2E_WORLD: WORLD },
          inheritEnv: ["E2E_KEEP_WORLD", "FAKE_CLAUDE_DELAY_MS"],
          log: ".e2e/logs/app.log",
          startupTimeout: 30_000,
        },
      },
    },
  ],
  agents: {
    default: {
      model: anthropic("claude-opus-5-5"),
      context:
        "PR Review Desk lists GitHub pull requests, runs code reviews on them, and shows the review's findings. " +
        "A finding has a comment that can be edited, posted to GitHub, dismissed, or reopened. " +
        "The left rail holds the sections (Pull requests, Local branches, Repositories) and the System and Mode switches.",
      system: "Do only what the goal asks, then stop. Never post, dismiss or start anything the goal does not name.",
    },
  },
} satisfies E2EConfig;
