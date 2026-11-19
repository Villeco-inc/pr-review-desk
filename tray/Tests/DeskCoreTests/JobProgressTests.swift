import Testing
@testable import DeskCore

@Test func buildKitStagesAreSummedAndEachStageCountsItsHighestStep() {
    let log = """
    #1 [internal] load build definition from Dockerfile
    #5 [build 1/6] FROM docker.io/library/node:22-slim
    #6 [build 2/6] WORKDIR /app
    #7 [build 3/6] COPY package*.json ./
    #7 CACHED
    #8 [runtime 1/4] FROM docker.io/library/node:22-slim
    #9 [build 4/6] RUN npm ci
    #9 12.3 added 412 packages
    """
    #expect(parseBuildProgress(log) == BuildProgress(target: .image, done: 5, total: 10))
}

@Test func paddedBuildKitCountersAreRead() {
    let log = """
    #12 [runtime  9/11] COPY --from=build /app/dist ./dist
    #13 [runtime 10/11] RUN npm prune --omit=dev
    """
    #expect(parseBuildProgress(log) == BuildProgress(target: .image, done: 10, total: 11))
}

@Test func singleStageBuildKitCounterWithoutAStageName() {
    #expect(parseBuildProgress("#4 [2/3] RUN make\n") == BuildProgress(target: .image, done: 2, total: 3))
}

@Test func swiftPMCountersAfterTheImageBuildMeanTheAppIsCompiling() {
    let log = """
    #9 [build 6/6] RUN npm run build
    [12/40] Compiling DeskCore MenuModel.swift
    [13/40] Compiling DeskCore UpdateState.swift
    """
    #expect(parseBuildProgress(log) == BuildProgress(target: .app, done: 13, total: 40))
}

@Test func noCounterYetMeansNoProgress() {
    #expect(parseBuildProgress("Démarrage du Desk…\n#1 [internal] load .dockerignore\n") == nil)
    #expect(parseBuildProgress("") == nil)
}

@Test func doneNeverExceedsTotal() {
    #expect(parseBuildProgress("[9/8] Linking DeskTray\n") == BuildProgress(target: .app, done: 8, total: 8))
}

private func line(_ kind: JobKind, _ step: JobStep) -> MenuItem? {
    buildMenu(desk: .starting, dev: .stopped, update: .checkPending, clipboard: .none, launchAtLogin: true, port: 37703,
              foreignRemote: false, job: JobProgress(kind: kind, step: step)).dropFirst().first
}

@Test func jobLineNamesTheActionAndItsStep() {
    #expect(line(.update, .fetching) == .info("Mise à jour en cours…", detail: "récupération des changements"))
    #expect(line(.update, .building(BuildProgress(target: .image, done: 3, total: 8)))
        == .info("Mise à jour en cours…", detail: "construction de l'image ███░░░░░░░ 3/8 · 37 %"))
    #expect(line(.rebuild, .building(BuildProgress(target: .app, done: 40, total: 40)))
        == .info("Reconstruction en cours…", detail: "compilation de l'app ██████████ 40/40 · 100 %"))
    #expect(line(.start, .waitingForDesk) == .info("Démarrage en cours…", detail: "démarrage du Desk"))
    #expect(line(.update, .rebuildingApp) == .info("Mise à jour en cours…", detail: "reconstruction de l'app"))
    #expect(line(.restart, .preparing) == .info("Redémarrage en cours…", detail: nil))
    #expect(line(.stop, .preparing) == .info("Arrêt en cours…", detail: nil))
}

@Test func jobLineReplacesTheStartingLine() {
    let items = buildMenu(desk: .starting, dev: .stopped, update: .checkPending, clipboard: .none, launchAtLogin: true, port: 37703,
                          foreignRemote: false, job: JobProgress(kind: .start, step: .preparing))
    #expect(!items.contains(.info("Démarrage du Desk…", detail: nil)))
    let idle = buildMenu(desk: .starting, dev: .stopped, update: .checkPending, clipboard: .none, launchAtLogin: true, port: 37703,
                         foreignRemote: false)
    #expect(idle.contains(.info("Démarrage du Desk…", detail: nil)))
}

@Test func jobLineSitsAboveARunningDesk() {
    let items = buildMenu(desk: .running(version: "a1b2c3d"), dev: .stopped, update: .upToDate, clipboard: .none, launchAtLogin: true,
                          port: 37703, foreignRemote: false, job: JobProgress(kind: .update, step: .fetching))
    #expect(Array(items.prefix(3)) == [
        .header("PR REVIEW DESK"),
        .info("Mise à jour en cours…", detail: "récupération des changements"),
        .info("Desk en marche", detail: ":37703"),
    ])
}

@Test func dockerfileStepsCountTheInstructionsBuildKitNumbers() {
    let dockerfile = """
    FROM node:22-slim AS build
    WORKDIR /app
    COPY package*.json ./
    RUN npm ci

    from node:22-slim as runtime
    RUN apt-get update \\
      && apt-get install -y git
    ADD https://example.com/x.tgz /x.tgz
    ARG DESK_COMMIT=inconnue
    ENV DESK_COMMIT=$DESK_COMMIT
    EXPOSE 3100
    # RUN commented out
    CMD ["node", "index.js"]
    """
    #expect(dockerfileSteps(dockerfile) == 7)
}

@Test func plannedStepsKeepTheTotalFromGrowingWhenALaterStageStarts() {
    let firstStageDone = "#11 [build 6/6] RUN npm run build\n"
    #expect(parseBuildProgress(firstStageDone, plannedSteps: 17) == BuildProgress(target: .image, done: 6, total: 17))
    let secondStage = firstStageDone + "#12 [runtime  3/11] RUN apt-get update\n"
    #expect(parseBuildProgress(secondStage, plannedSteps: 17) == BuildProgress(target: .image, done: 9, total: 17))
}
