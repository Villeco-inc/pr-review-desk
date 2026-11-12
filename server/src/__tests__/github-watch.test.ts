import { describe, expect, it } from "vitest";
import { buildRepoState, deskCommentIdsByRepo, diffRepoState, type RepoWatchInput } from "../services/github-watch";
import type { PrReviewComment } from "../services/github";

const REPO = "Villeco-inc/villeco";

function input(over: Partial<RepoWatchInput> = {}): RepoWatchInput {
  return {
    repo: REPO,
    viewer: "davidrlarochelle",
    requested: [],
    openPrs: [{ number: 10, title: "Ten", url: "https://github.com/Villeco-inc/villeco/pull/10", headRefOid: "aaa" }],
    reviewedHeads: new Map(),
    deskCommentIds: new Set(),
    reviewComments: new Map(),
    ...over,
  };
}

const comment = (over: Partial<PrReviewComment>): PrReviewComment => ({
  id: 1,
  inReplyToId: null,
  author: "someone",
  isBot: false,
  body: "Fair point, fixed.",
  url: "https://github.com/Villeco-inc/villeco/pull/10#discussion_r1",
  createdAt: "2026-10-15T12:00:00Z",
  ...over,
});

const requestFor = (number: number, repo = REPO) => ({ repo, number, title: `PR ${number}`, url: `https://github.com/${repo}/pull/${number}`, author: "Cryptunas" });

describe("first look at a repository", () => {
  it("emits nothing, however much is already there", () => {
    const after = buildRepoState(
      input({
        requested: [requestFor(10)],
        reviewedHeads: new Map([[10, "old"]]),
        deskCommentIds: new Set([500]),
        reviewComments: new Map([[10, [comment({ id: 501, inReplyToId: 500 })]]]),
      })
    );
    expect(after.requested.size + after.moved.size + after.replies.size).toBe(3);
    expect(diffRepoState(REPO, undefined, after)).toEqual([]);
  });
});

describe("review requested", () => {
  it("fires for a PR newly asking for the viewer's review, once", () => {
    const before = buildRepoState(input());
    const after = buildRepoState(input({ requested: [requestFor(10)] }));
    expect(diffRepoState(REPO, before, after)).toEqual([
      { kind: "review-requested", repo: REPO, number: 10, title: "PR 10", url: "https://github.com/Villeco-inc/villeco/pull/10", author: "Cryptunas" },
    ]);
    expect(diffRepoState(REPO, after, buildRepoState(input({ requested: [requestFor(10)] })))).toEqual([]);
  });

  it("ignores requests on other repositories", () => {
    const after = buildRepoState(input({ requested: [requestFor(10, "Villeco-inc/linea-web")] }));
    expect(diffRepoState(REPO, buildRepoState(input()), after)).toEqual([]);
  });

  it("fires again when the request comes back after being cleared", () => {
    const asked = buildRepoState(input({ requested: [requestFor(10)] }));
    const cleared = buildRepoState(input());
    expect(diffRepoState(REPO, asked, cleared)).toEqual([]);
    expect(diffRepoState(REPO, cleared, asked).map((e) => e.kind)).toEqual(["review-requested"]);
  });
});

describe("new commits on a reviewed PR", () => {
  const reviewed = new Map([[10, "aaa"]]);
  const at = (head: string) => [{ number: 10, title: "Ten", url: "https://github.com/Villeco-inc/villeco/pull/10", headRefOid: head }];

  it("fires when the head moves off the reviewed commit", () => {
    const before = buildRepoState(input({ reviewedHeads: reviewed, openPrs: at("aaa") }));
    const after = buildRepoState(input({ reviewedHeads: reviewed, openPrs: at("bbb") }));
    expect(diffRepoState(REPO, before, after)).toEqual([
      { kind: "new-commits", repo: REPO, number: 10, title: "Ten", url: "https://github.com/Villeco-inc/villeco/pull/10", head: "bbb", reviewedHead: "aaa" },
    ]);
  });

  it("fires again on each further push, not on a quiet poll", () => {
    const b = buildRepoState(input({ reviewedHeads: reviewed, openPrs: at("bbb") }));
    expect(diffRepoState(REPO, b, buildRepoState(input({ reviewedHeads: reviewed, openPrs: at("bbb") })))).toEqual([]);
    expect(diffRepoState(REPO, b, buildRepoState(input({ reviewedHeads: reviewed, openPrs: at("ccc") }))).map((e) => e.kind)).toEqual(["new-commits"]);
  });

  it("stays quiet on PRs the Desk never reviewed", () => {
    const before = buildRepoState(input({ openPrs: at("aaa") }));
    expect(diffRepoState(REPO, before, buildRepoState(input({ openPrs: at("bbb") })))).toEqual([]);
  });

  it("stays quiet when the Desk reviews the new head itself", () => {
    const before = buildRepoState(input({ reviewedHeads: reviewed, openPrs: at("aaa") }));
    const after = buildRepoState(input({ reviewedHeads: new Map([[10, "bbb"]]), openPrs: at("bbb") }));
    expect(diffRepoState(REPO, before, after)).toEqual([]);
  });
});

describe("replies under Desk comments", () => {
  const desk = new Set([500]);
  const withComments = (...comments: PrReviewComment[]) => input({ deskCommentIds: desk, reviewComments: new Map([[10, comments]]) });

  it("fires for a human reply to a Desk comment", () => {
    const before = buildRepoState(withComments(comment({ id: 500, author: "davidrlarochelle" })));
    const reply = comment({ id: 501, inReplyToId: 500, author: "Cryptunas", url: "https://github.com/Villeco-inc/villeco/pull/10#discussion_r501" });
    const after = buildRepoState(withComments(comment({ id: 500, author: "davidrlarochelle" }), reply));
    expect(diffRepoState(REPO, before, after)).toEqual([
      {
        kind: "comment-reply",
        repo: REPO,
        number: 10,
        title: "Ten",
        commentId: 501,
        author: "Cryptunas",
        body: "Fair point, fixed.",
        url: "https://github.com/Villeco-inc/villeco/pull/10#discussion_r501",
      },
    ]);
  });

  it("ignores bots, the viewer's own replies, and replies under other comments", () => {
    const before = buildRepoState(withComments());
    const after = buildRepoState(
      withComments(
        comment({ id: 601, inReplyToId: 500, author: "greptile-apps[bot]", isBot: true }),
        comment({ id: 602, inReplyToId: 500, author: "DavidRLarochelle" }),
        comment({ id: 603, inReplyToId: 999, author: "Cryptunas" }),
        comment({ id: 604, inReplyToId: null, author: "Cryptunas" })
      )
    );
    expect(diffRepoState(REPO, before, after)).toEqual([]);
  });

  it("does not repeat a reply already seen", () => {
    const state = buildRepoState(withComments(comment({ id: 501, inReplyToId: 500 })));
    expect(diffRepoState(REPO, state, buildRepoState(withComments(comment({ id: 501, inReplyToId: 500 }))))).toEqual([]);
  });
});

describe("Desk comment URLs", () => {
  it("keeps inline-comment ids by repository and skips issue comments", () => {
    const ids = deskCommentIdsByRepo([
      "https://github.com/Villeco-inc/villeco/pull/2820#discussion_r4287105163",
      "https://github.com/Villeco-inc/villeco/pull/2817#discussion_r4287099686",
      "https://github.com/Villeco-inc/linea-iot/pull/20#discussion_r42",
      "https://github.com/Villeco-inc/villeco/pull/2810#issuecomment-5701",
    ]);
    expect([...ids.entries()].map(([repo, set]) => [repo, [...set]])).toEqual([
      ["Villeco-inc/villeco", [4287105163, 4287099686]],
      ["Villeco-inc/linea-iot", [42]],
    ]);
  });
});
