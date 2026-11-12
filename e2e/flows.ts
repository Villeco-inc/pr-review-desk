// The user flows, one function each, so a test file can run one as is (tests/*.e2e.ts) or in
// another setting (tests/theme.e2e.ts runs them again in the second design system).
//
// The rule every flow follows: agent.act moves through the app, one goal per call, and each
// act is followed right away by an expect on the screen, which lets the replay cache record it.
// Everything that is checked is checked in code: the screen with expect, the database and the
// fake CLIs' journals with world-state.ts. No agent.assert: it would call the model on every run.
// Texts are matched with /…/i: two of the design systems print labels in capitals.
import type { TestFixtures } from "e2e";
import { expect } from "e2e";
import type { Browser } from "@e2e-dev/web";
import {
  claudeCalls,
  findingByTitle,
  ghFailures,
  ghWrites,
  holdClaude,
  notificationKinds,
  processAlive,
  releaseClaude,
  resetWorld,
  reviewStatus,
  reviewsLike,
  runStatuses,
  seedReview,
  selectedRepos,
} from "./harness/world-state";

export type Desk = TestFixtures & { browser: Browser };

export const PR = {
  repo: "acme/widgets",
  number: 42,
  title: "Add retry to the payment client",
  head: "4242424242424242424242424242424242424242",
};
export const HIGH = "Retrying a charge can bill the customer twice";
export const NIT = "Name the retry limit";

/** 1. First launch: the repository picker cannot be skipped; once saved, the PR list shows. */
export async function pickReposOnFirstLaunch({ app, agent, screen }: Desk): Promise<void> {
  resetWorld();
  await app.open("/");
  const picker = screen.getByRole("dialog", "Pick your repositories");
  await expect(picker).toBeVisible();

  await agent.act("in the repository picker, tick {repo} and save", { params: { repo: PR.repo } });
  await expect(picker).toBeHidden();
  await expect(screen.getByRole("button", PR.title)).toBeVisible();
  await expect(screen.getByRole("button", "Bump the date library")).toBeVisible();
  expect(selectedRepos()).toEqual([PR.repo]);
  expect(ghFailures()).toEqual([]);
}

/** 2. Open a PR, start a review, see it running, then its findings once it reports. */
export async function reviewPullRequest({ app, agent, screen }: Desk): Promise<void> {
  resetWorld({ repos: [PR.repo] });
  await app.open("/prs");

  await agent.act("open the pull request {title}", { params: { title: PR.title } });
  await expect(screen.getByRole("heading", { name: /add retry to the payment client/i, level: 1 })).toBeVisible();

  holdClaude();
  await agent.act("start a review of this pull request");
  await expect(screen.getByRole("button", /review running/i)).toBeVisible();
  expect(reviewStatus(`${PR.repo}#${PR.number}`)).toBe("running");

  releaseClaude();
  await expect(screen.getByText(/^reported$/i)).toBeVisible({ timeout: 15_000 });
  await expect(screen.getByRole("button", new RegExp(HIGH, "i"))).toBeVisible();
  await expect(screen.getByRole("button", new RegExp(NIT, "i"))).toBeVisible();
  expect(reviewStatus(`${PR.repo}#${PR.number}`)).toBe("reported");
  expect(claudeCalls().map((c) => c.report)).toEqual(["report-pr.json"]);
  expect(ghWrites()).toEqual([]);
  expect(ghFailures()).toEqual([]);
}

/** 3. Edit a finding's comment and post it: the fake gh must receive that text, on that file and those lines. */
export async function editAndPostComment({ app, agent, screen }: Desk): Promise<void> {
  resetWorld({ repos: [PR.repo] });
  await seedReview(PR.repo, PR.number);
  await app.open(`/prs/${PR.repo}/${PR.number}`);

  await agent.act("open the finding {title}", { params: { title: HIGH } });
  await expect(screen.getByRole("heading", { name: new RegExp(HIGH, "i"), level: 1 })).toBeVisible();

  // The exact text is the point of the test: typed in code, not by the agent.
  const body = "Retrying a POST can charge twice. Send an Idempotency-Key header with each charge.";
  await screen.getByRole("textbox", "Comment body").fill(body);

  await agent.act("post the comment of this finding");
  await expect(screen.getByText(/posted as comment/i)).toBeVisible({ timeout: 10_000 });

  expect(ghWrites()).toEqual([
    {
      endpoint: `repos/${PR.repo}/pulls/${PR.number}/comments`,
      method: "POST",
      fields: { body, commit_id: PR.head, path: "src/payments/client.ts", line: 15, side: "RIGHT", start_line: 14, start_side: "RIGHT" },
    },
  ]);
  const finding = findingByTitle(HIGH);
  expect(finding?.state).toBe("posted");
  expect(finding?.draft_comment).toBe(body);
  expect(ghFailures()).toEqual([]);
}

/** 4. Dismiss a finding, then reopen it; each state survives a reload. */
export async function dismissThenReopen({ app, agent, screen, browser }: Desk): Promise<void> {
  resetWorld({ repos: [PR.repo] });
  await seedReview(PR.repo, PR.number);
  await app.open(`/prs/${PR.repo}/${PR.number}`);

  await agent.act("open the finding {title}", { params: { title: NIT } });
  await expect(screen.getByRole("heading", { name: new RegExp(NIT, "i"), level: 1 })).toBeVisible();

  await agent.act("dismiss this finding");
  await expect(screen.getByRole("button", /^reopen$/i)).toBeVisible();
  expect(findingByTitle(NIT)?.state).toBe("dismissed");

  await browser.reload();
  await expect(screen.getByRole("heading", { name: new RegExp(NIT, "i"), level: 1 })).toBeVisible();
  await expect(screen.getByRole("button", /^reopen$/i)).toBeVisible();

  await agent.act("reopen this finding");
  await expect(screen.getByRole("button", /^dismiss$/i)).toBeVisible();
  expect(findingByTitle(NIT)?.state).toBe("open");

  await browser.reload();
  await expect(screen.getByRole("button", /^dismiss$/i)).toBeVisible();
  expect(ghWrites()).toEqual([]);
  expect(ghFailures()).toEqual([]);
}

/** 5. Review a local branch of the checkout the harness made (sample-app, feat/divide against main). */
export async function reviewLocalBranch({ app, agent, screen }: Desk): Promise<void> {
  resetWorld({ repos: [PR.repo] });
  await app.open("/local");

  await agent.act("choose the branch {branch} of sample-app, compared with {base}", { params: { branch: "feat/divide", base: "main" } });
  await expect(screen.getByText(/will review 1 file/i)).toBeVisible();

  holdClaude();
  await agent.act("start the review");
  await expect(screen.getByRole("button", /review running/i)).toBeVisible();

  await agent.act("view the latest review of this branch");
  await expect(screen.getByRole("heading", { name: /add divide\(\)/i, level: 1 })).toBeVisible();

  releaseClaude();
  await expect(screen.getByText(/^reported$/i)).toBeVisible({ timeout: 15_000 });
  await expect(screen.getByRole("button", /dividing by zero returns infinity/i)).toBeVisible();
  expect(reviewsLike("local/sample-app-%").map((r) => r.status)).toEqual(["reported"]);
  expect(claudeCalls().map((c) => c.report)).toEqual(["report-local.json"]);
  expect(ghFailures()).toEqual([]);
}

/** 7. Instructions typed before a review reach the agent: the prompt the fake claude got holds them. */
export async function reviewWithInstructions({ app, agent, screen }: Desk): Promise<void> {
  resetWorld({ repos: [PR.repo] });
  await app.open(`/prs/${PR.repo}/${PR.number}`);
  await expect(screen.getByRole("heading", { name: /add retry to the payment client/i, level: 1 })).toBeVisible();

  // The exact text is the point of the test: typed in code, not by the agent.
  const instructions = "Focus on idempotency: can a retried charge bill the customer twice? Leave naming alone.";
  await screen.getByLabel(/instructions for the review agent/i).fill(instructions);

  holdClaude();
  await agent.act("start a review of this pull request");
  await expect(screen.getByRole("button", /review running/i)).toBeVisible();
  releaseClaude();
  await expect(screen.getByText(/^reported$/i)).toBeVisible({ timeout: 15_000 });

  const calls = claudeCalls();
  expect(calls).toHaveLength(1);
  const section = calls[0].prompt.split("## Consignes du relecteur")[1]?.split("\n## ")[0] ?? "";
  expect(section).toContain(instructions);
  expect(ghFailures()).toEqual([]);
}

/** 8. Cancel a running review: the agent process stops, the review reads cancelled, and nothing is notified. */
export async function cancelRunningReview({ app, agent, screen }: Desk): Promise<void> {
  resetWorld({ repos: [PR.repo] });
  await app.open(`/prs/${PR.repo}/${PR.number}`);
  await expect(screen.getByRole("heading", { name: /add retry to the payment client/i, level: 1 })).toBeVisible();

  holdClaude();
  await agent.act("start a review of this pull request");
  await expect(screen.getByRole("button", /review running/i)).toBeVisible();

  await agent.act("cancel the running review");
  await expect(screen.getByText(/^cancelled$/i)).toBeVisible({ timeout: 10_000 });
  await expect(screen.getByRole("button", /^start review$/i)).toBeVisible();

  const id = `${PR.repo}#${PR.number}`;
  expect(reviewStatus(id)).toBe("cancelled");
  expect(runStatuses(id)).toEqual(["cancelled"]);
  const [call] = claudeCalls();
  expect(processAlive(call.pid)).toBe(false);

  // Released, a live agent would report within a second: a stopped one leaves the review cancelled.
  releaseClaude();
  await new Promise((r) => setTimeout(r, 1_500));
  expect(reviewStatus(id)).toBe("cancelled");
  expect(notificationKinds()).toEqual([]);
  expect(ghFailures()).toEqual([]);
}
