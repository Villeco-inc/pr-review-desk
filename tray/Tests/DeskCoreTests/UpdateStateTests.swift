import Testing
@testable import DeskCore

private func facts(clean: Bool = true, branch: String? = "main", main: Bool = true, head: String = "a1b2c3d",
                   behind: Int = 0, ahead: Int = 0, fetchError: String? = nil) -> CloneFacts {
    CloneFacts(isMainClone: main, branch: branch, isClean: clean, head: head, originMain: "ffffff0",
               behind: behind, ahead: ahead, fetchError: fetchError, isReferenceRemote: true)
}

@Test func upToDate() { #expect(updateState(running: "a1b2c3d", facts: facts()) == .upToDate) }
@Test func availableWhenBehindAndClean() { #expect(updateState(running: "a1b2c3d", facts: facts(behind: 3)) == .available(commits: 3)) }
@Test func blockedWhenDirty() { #expect(updateState(running: "a1b2c3d", facts: facts(clean: false, behind: 3)) == .blocked(.dirty)) }
@Test func blockedWhenDiverged() { #expect(updateState(running: "a1b2c3d", facts: facts(behind: 2, ahead: 1)) == .blocked(.diverged)) }
@Test func blockedWhenOnlyAhead() { #expect(updateBlockReason(facts(ahead: 1)) == .diverged) }
@Test func blockedWhenNotOnMain() {
    #expect(updateState(running: nil, facts: facts(branch: "feat/x", behind: 1)) == .blocked(.notOnMain("feat/x")))
    #expect(updateBlockReason(facts(branch: nil)) == .notOnMain(nil))
}
@Test func blockedWhenNotMainClone() { #expect(updateBlockReason(facts(main: false)) == .notMainClone) }
@Test func noBlockWhenFine() { #expect(updateBlockReason(facts()) == nil) }
@Test func rebuildNeeded() { #expect(updateState(running: "0000000", facts: facts()) == .rebuildNeeded) }
@Test func stoppedDeskIsUpToDate() { #expect(updateState(running: nil, facts: facts()) == .upToDate) }
@Test func fetchErrorWins() { #expect(updateState(running: "a1b2c3d", facts: facts(behind: 3, fetchError: "réseau")) == .checkFailed("réseau")) }
@Test func shortShasOfDifferentLengthsNameTheSameCommit() {
    #expect(updateState(running: "a1b2c3d", facts: facts(head: "a1b2c3d4")) == .upToDate)
    #expect(updateState(running: "a1b2c3d4", facts: facts(head: "a1b2c3d")) == .upToDate)
    #expect(updateState(running: "a1b2c3e", facts: facts(head: "a1b2c3d4")) == .rebuildNeeded)
}
@Test func changesStartFromTheRunningVersionElseFromTheClone() {
    #expect(changesBase(running: "a1b2c3d", head: "0f0f0f0") == "a1b2c3d")
    #expect(changesBase(running: nil, head: "0f0f0f0") == "0f0f0f0")
    #expect(changesBase(running: nil, head: "") == nil)
    #expect(changesBase(running: nil, head: nil) == nil)
}
