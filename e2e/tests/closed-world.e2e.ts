import { expect, test } from "e2e";
import { HIGH, PR } from "../flows";
import { api, findingByTitle, ghCalls, ghFailures, resetWorld, seedReview } from "../harness/world-state";

// No screen here: the GitHub poller runs in the background (every 120 s), so the test makes it
// poll now, twice (a first look, then a comparison), over a PR the Desk has commented on, and
// checks that the fake gh answered every call it made. Nothing in the fixtures moves between
// the two looks, so there is nothing to notify.
test("the GitHub poller stays inside the closed world", async () => {
  resetWorld({ repos: [PR.repo] });
  await seedReview(PR.repo, PR.number);
  const high = findingByTitle(HIGH);
  await api("POST", `/api/findings/${high?.id}/post`, { mode: "inline" });

  expect(await api("POST", "/api/notifications/poll")).toEqual({ events: 0 });
  expect(await api("POST", "/api/notifications/poll")).toEqual({ events: 0 });

  const calls = ghCalls().map((args) => args.join(" "));
  const made = (pattern: RegExp) => expect(calls.filter((c) => pattern.test(c)), `a gh call matching ${pattern}`).not.toHaveLength(0);
  made(/^search prs --review-requested=@me/);
  made(/^pr list -R acme\/widgets .*number,title,url,headRefOid$/);
  made(/^api --paginate repos\/acme\/widgets\/pulls\/42\/comments\?per_page=100$/);
  expect(ghFailures()).toEqual([]);
});
