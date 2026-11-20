import Testing
@testable import DeskCore

@Test func remotes() {
    #expect(isReferenceRemote("git@github.com:Villeco-inc/pr-review-desk.git"))
    #expect(isReferenceRemote("https://github.com/villeco-inc/PR-review-desk"))
    #expect(!isReferenceRemote("https://github.com/davidrlarochelle/pr-review-desk.git"))
}
