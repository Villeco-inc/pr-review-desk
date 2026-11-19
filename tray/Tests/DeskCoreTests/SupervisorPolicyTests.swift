import Testing
@testable import DeskCore

private func step(dockerUp: Bool = true, healthy: Bool = false, stoppedByUser: Bool = false, misses: Int = 2,
                  sinceDockerBack: Double? = nil) -> StartStep {
    nextStartStep(dockerUp: dockerUp, deskHealthy: healthy, stoppedByUser: stoppedByUser, consecutiveMisses: misses,
                  secondsSinceDockerBack: sinceDockerBack)
}

@Test func dockerDownWinsWhateverTheUserDid() {
    #expect(step(dockerUp: false) == .dockerDown)
    #expect(step(dockerUp: false, stoppedByUser: true) == .dockerDown)
}
@Test func healthyDeskNeedsNothing() { #expect(step(healthy: true, misses: 0) == .done) }
@Test func healthyDeskWinsOverSilentDocker() { #expect(step(dockerUp: false, healthy: true, misses: 0) == .done) }
@Test func silentDeskWithDockerUpRunsStartScript() { #expect(step(misses: 2) == .runStartScript) }
@Test func deskStoppedByUserStaysStopped() { #expect(step(stoppedByUser: true, misses: 5) == .done) }
@Test func oneMissedProbeOnlyWaits() { #expect(step(misses: 1) == .wait) }
@Test func dockerJustBackLeavesTheContainerTimeToRestart() {
    #expect(step(misses: 3, sinceDockerBack: 29) == .wait)
    #expect(step(misses: 3, sinceDockerBack: 30) == .runStartScript)
}

@Test func startFailureShowsLastCrossLine() {
    let out = "✗ premier échec\nBuilding…\n✗ Docker n'est pas démarré.\n"
    #expect(startFailureMessage(output: out, code: 1) == "Docker n'est pas démarré.")
}
@Test func startFailureWithoutCrossLineShowsCode() {
    #expect(startFailureMessage(output: "boom\n", code: 3) == "start.sh a échoué (code 3)")
}
