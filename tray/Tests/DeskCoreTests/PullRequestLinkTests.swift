import Testing
@testable import DeskCore

@Test(arguments: ["https://github.com/Villeco-inc/linea-web/pull/123", " https://github.com/Villeco-inc/linea-web/pull/123/files\n",
                  "https://github.com/Villeco-inc/linea-web/pull/123#discussion_r1", "https://github.com/Villeco-inc/linea-web/pull/123?w=1"])
func prLinkRecognized(_ s: String) {
    #expect(parsePullRequestLink(s) == PullRequestLink(owner: "Villeco-inc", repo: "linea-web", number: 123))
}

@Test(arguments: ["https://github.com/Villeco-inc/linea-web/issues/1", "https://github.com/Villeco-inc/linea-web/commit/abc",
                  "https://gitlab.com/a/b/pull/1", "voir https://github.com/a/b/pull/1 svp", ""])
func prLinkIgnored(_ s: String) { #expect(parsePullRequestLink(s) == nil) }

@Test func slug() { #expect(PullRequestLink(owner: "a", repo: "b", number: 7).slug == "a/b#7") }

private let pr3 = PullRequestLink(owner: "Villeco-inc", repo: "pr-review-desk", number: 3)

@Test func readablePullRequestOfAFollowedRepoIgnoresCase() {
    #expect(clipboardCheckResult(pr3, pullRequest: CopiedPullRequest(title: "Thème Linea", reviewStatus: nil, headSha: "aaa111", reviewedHeadSha: nil),
                                 followedRepos: ["villeco-inc/PR-Review-Desk"])
        == .ready(pr3, title: "Thème Linea", review: .none, followed: true))
}

@Test func readablePullRequestOutsideTheSelectionIsFollowable() {
    #expect(clipboardCheckResult(pr3, pullRequest: CopiedPullRequest(title: "T", reviewStatus: nil, headSha: "aaa111", reviewedHeadSha: nil),
                                 followedRepos: ["Villeco-inc/linea-web", "Villeco-inc/pr-review"])
        == .ready(pr3, title: "T", review: .none, followed: false))
}

@Test(arguments: ["queued", "running"])
func queuedOrRunningReviewIsInProgress(_ status: String) {
    #expect(clipboardCheckResult(pr3, pullRequest: CopiedPullRequest(title: "T", reviewStatus: status, headSha: "bbb222", reviewedHeadSha: "aaa111"), followedRepos: [])
        == .ready(pr3, title: "T", review: .running, followed: false))
}

@Test func unreadablePullRequestIsInaccessible() {
    #expect(clipboardCheckResult(pr3, pullRequest: nil, followedRepos: ["Villeco-inc/pr-review-desk"]) == .inaccessible(pr3))
}

@Test func unreachableDeskGivesNoAnswer() {
    #expect(clipboardCheckResult(pr3, pullRequest: CopiedPullRequest(title: "T", reviewStatus: nil, headSha: "aaa111", reviewedHeadSha: nil), followedRepos: nil) == nil)
    #expect(clipboardCheckResult(pr3, pullRequest: nil, followedRepos: nil) == nil)
}

@Test func reviewOfTheCurrentCommitIsUpToDate() {
    #expect(clipboardCheckResult(pr3, pullRequest: CopiedPullRequest(title: "T", reviewStatus: "reported", headSha: "aaa111", reviewedHeadSha: "aaa111"),
                                 followedRepos: ["Villeco-inc/pr-review-desk"])
        == .ready(pr3, title: "T", review: .upToDate, followed: true))
}

@Test func commitsPushedSinceTheReviewMakeItOutdated() {
    #expect(clipboardCheckResult(pr3, pullRequest: CopiedPullRequest(title: "T", reviewStatus: "failed", headSha: "bbb222", reviewedHeadSha: "aaa111"),
                                 followedRepos: ["Villeco-inc/pr-review-desk"])
        == .ready(pr3, title: "T", review: .outdated, followed: true))
}
