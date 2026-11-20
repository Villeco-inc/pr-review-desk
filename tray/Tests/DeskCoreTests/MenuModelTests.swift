import Testing
@testable import DeskCore

private let link = PullRequestLink(owner: "Villeco-inc", repo: "linea-web", number: 123)

private func menu(desk: DeskStatus = .running(version: "a1b2c3d"), dev: DevStatus = .running(port: 5173),
                  update: UpdateState = .upToDate, clipboard: ClipboardState = .none,
                  launchAtLogin: Bool = true, foreign: Bool = false, notice: MenuNotice? = nil,
                  canShowChanges: Bool = true, job: JobProgress? = nil) -> [MenuItem] {
    buildMenu(desk: desk, dev: dev, update: update, clipboard: clipboard, launchAtLogin: launchAtLogin, port: 37703, foreignRemote: foreign,
              notice: notice, canShowChanges: canShowChanges, job: job)
}

private let devAndBottom: [MenuItem] = [
    .separator, .header("MODE DEV"), .info("Dev en marche", detail: ":5173"),
    .action(.openDev, title: "Ouvrir le Dev", bold: false, enabled: true),
    .separator, .action(.showLogs, title: "Voir les journaux…", bold: false, enabled: true),
    .toggle(.toggleLaunchAtLogin, title: "Lancer au démarrage du Mac", on: true),
    .action(.quit, title: "Quitter", bold: false, enabled: true),
]
private let runningActions: [MenuItem] = [
    .separator, .action(.openDesk, title: "Ouvrir le Desk", bold: false, enabled: true),
    .action(.restart, title: "Redémarrer", bold: false, enabled: true),
    .action(.stop, title: "Arrêter", bold: false, enabled: true),
]

@Test func mockupA() {
    #expect(menu() == [
        .header("PR REVIEW DESK"), .info("Desk en marche", detail: ":37703"),
        .info("Version a1b2c3d · à jour", detail: nil),
    ] + runningActions + devAndBottom)
}

@Test func mockupB() {
    #expect(menu(update: .available(commits: 3)) == [
        .header("PR REVIEW DESK"), .info("Desk en marche", detail: ":37703"),
        .info("Nouvelle version", detail: "3 commits"),
        .action(.update, title: "Mettre à jour et redémarrer", bold: false, enabled: true),
        .action(.showChanges, title: "Voir les changements…", bold: false, enabled: true),
    ] + runningActions + devAndBottom)
}

@Test func singleCommitIsSingular() {
    #expect(menu(update: .available(commits: 1)).contains(.info("Nouvelle version", detail: "1 commit")))
}

@Test func mockupC() {
    let m = menu(desk: .dockerDown, dev: .stopped, launchAtLogin: false)
    #expect(m == [
        .header("PR REVIEW DESK"),
        .info("Docker n'est pas démarré", detail: nil),
        .action(.checkDocker, title: "Vérifier si Docker est démarré", bold: true, enabled: true),
        .separator, .action(.openDesk, title: "Ouvrir le Desk", bold: false, enabled: false),
        .separator, .header("MODE DEV"), .info("Dev arrêté", detail: nil),
        .separator, .action(.showLogs, title: "Voir les journaux…", bold: false, enabled: true),
        .toggle(.toggleLaunchAtLogin, title: "Lancer au démarrage du Mac", on: false),
        .action(.quit, title: "Quitter", bold: false, enabled: true),
    ])
}

@Test func menuRebuildNeeded() {
    let m = menu(update: .rebuildNeeded)
    #expect(Array(m[1...3]) == [.info("Desk en marche", detail: ":37703"), .info("Version a1b2c3d", detail: nil),
                                .action(.rebuild, title: "Reconstruire", bold: false, enabled: true)])
}

@Test func checkFailedAndBlocked() {
    #expect(menu(update: .checkFailed("réseau"))[2] == .info("Vérification des mises à jour impossible", detail: "réseau"))
    let cases: [(UpdateBlock, String)] = [
        (.dirty, "le clone n'est pas propre"), (.notOnMain("x"), "le clone n'est pas sur main"),
        (.notMainClone, "ce dossier n'est pas le clone principal"), (.diverged, "main a divergé d'origin"),
    ]
    for (block, cause) in cases {
        #expect(menu(update: .blocked(block))[2] == .info("⚠ Mise à jour bloquée : \(cause)", detail: nil))
    }
}

@Test func startingStoppedFailed() {
    #expect(menu(desk: .starting).prefix(3) == [.header("PR REVIEW DESK"), .info("Démarrage du Desk…", detail: nil), .separator])
    #expect(menu(desk: .stopped(reason: "arrêté par toi")).prefix(4) == [
        .header("PR REVIEW DESK"), .info("Desk arrêté", detail: "arrêté par toi"),
        .action(.start, title: "Démarrer", bold: true, enabled: true), .separator])
    let failed = menu(desk: .failed("port pris"))
    #expect(failed.prefix(5) == [
        .header("PR REVIEW DESK"), .info("Le Desk n'a pas démarré", detail: "port pris"),
        .action(.openStartScriptInTerminal, title: "Ouvrir un Terminal sur ./start.sh", bold: true, enabled: true),
        .action(.start, title: "Démarrer", bold: false, enabled: true), .separator])
    for m in [menu(desk: .starting), menu(desk: .stopped(reason: nil)), menu(desk: .dockerDown), failed] {
        #expect(m.contains(.action(.openDesk, title: "Ouvrir le Desk", bold: false, enabled: false)))
        #expect(!m.contains(.action(.restart, title: "Redémarrer", bold: false, enabled: true)))
        #expect(!m.contains(.action(.stop, title: "Arrêter", bold: false, enabled: true)))
    }
}

@Test func stoppedDeskShowsOnlyActionableUpdateInfo() {
    #expect(!menu(desk: .stopped(reason: nil), update: .upToDate).contains(where: { if case .info(let t, _) = $0 { t.hasPrefix("Version") } else { false } }))
    #expect(menu(desk: .stopped(reason: nil), update: .available(commits: 2)).contains(.info("Nouvelle version", detail: "2 commits")))
    #expect(menu(desk: .stopped(reason: nil), update: .blocked(.dirty)).contains(.info("⚠ Mise à jour bloquée : le clone n'est pas propre", detail: nil)))
}

@Test func foreignRemoteLineAfterUpdateBlock() {
    let m = menu(update: .available(commits: 3), foreign: true)
    #expect(m[4] == .action(.showChanges, title: "Voir les changements…", bold: false, enabled: true))
    #expect(m[5] == .info("Ce clone suit un autre dépôt que Villeco-inc/pr-review-desk", detail: nil))
    #expect(m[6] == .separator)
    #expect(!menu().contains(.info("Ce clone suit un autre dépôt que Villeco-inc/pr-review-desk", detail: nil)))
}

@Test func clipboardReadyFollowed() {
    let m = menu(clipboard: .ready(link, title: "Corrige X", review: .none, followed: true))
    #expect(m.prefix(5) == [
        .header("LIEN EN PRESSE-PAPIER"),
        .action(.clipboardReview(link, follow: false), title: "Lancer la review de Villeco-inc/linea-web#123", bold: false, enabled: true),
        .info("Corrige X", detail: nil), .separator, .header("PR REVIEW DESK")])
}

@Test func clipboardReadyNotFollowed() {
    let m = menu(clipboard: .ready(link, title: "Corrige X", review: .none, followed: false))
    #expect(m[1] == .action(.clipboardReview(link, follow: true), title: "Suivre Villeco-inc/linea-web et lancer la review", bold: false, enabled: true))
}

@Test func clipboardReviewRunningIgnoresFollowed() {
    for followed in [true, false] {
        let m = menu(clipboard: .ready(link, title: "Corrige X", review: .running, followed: followed))
        #expect(m[1] == .action(.clipboardOpen(link), title: "Ouvrir la review en cours de Villeco-inc/linea-web#123", bold: false, enabled: true))
        #expect(m[2] == .info("Corrige X", detail: nil))
    }
}

@Test func clipboardUpToDateReviewIsOpenedEvenOutsideTheSelection() {
    for followed in [true, false] {
        let m = menu(clipboard: .ready(link, title: "Corrige X", review: .upToDate, followed: followed))
        #expect(m[1] == .action(.clipboardOpen(link), title: "Ouvrir la review de Villeco-inc/linea-web#123", bold: false, enabled: true))
        #expect(m[2] == .info("Corrige X", detail: "review à jour"))
    }
}

@Test func clipboardOutdatedReviewIsRestarted() {
    let m = menu(clipboard: .ready(link, title: "Corrige X", review: .outdated, followed: true))
    #expect(m[1] == .action(.clipboardReview(link, follow: false), title: "Relancer la review de Villeco-inc/linea-web#123", bold: false, enabled: true))
    #expect(m[2] == .info("Corrige X", detail: "nouveaux commits depuis la review"))
}

@Test func clipboardOutdatedReviewOutsideTheSelectionFollowsTheRepoFirst() {
    let m = menu(clipboard: .ready(link, title: "Corrige X", review: .outdated, followed: false))
    #expect(m[1] == .action(.clipboardReview(link, follow: true), title: "Suivre Villeco-inc/linea-web et lancer la review", bold: false, enabled: true))
    #expect(m[2] == .info("Corrige X", detail: "nouveaux commits depuis la review"))
}

@Test func clipboardCheckingAndNoneHaveNoSection() {
    #expect(menu(clipboard: .checking(link)) == menu())
    #expect(menu(clipboard: .none).first == .header("PR REVIEW DESK"))
}

@Test func clipboardInaccessible() {
    #expect(menu(clipboard: .inaccessible(link)).prefix(4) == [
        .header("LIEN EN PRESSE-PAPIER"), .info("PR inaccessible : Villeco-inc/linea-web#123", detail: nil),
        .separator, .header("PR REVIEW DESK")])
}

@Test func clipboardDisabledWhenDeskStopped() {
    let m = menu(desk: .stopped(reason: nil), clipboard: .ready(link, title: "T", review: .none, followed: true))
    #expect(m[1] == .action(.clipboardReview(link, follow: false), title: "Lancer la review de Villeco-inc/linea-web#123", bold: false, enabled: false))
}

@Test func devStoppedHasNoOpenDev() {
    let m = menu(dev: .stopped)
    #expect(m.contains(.info("Dev arrêté", detail: nil)))
    #expect(!m.contains(where: { if case .action(.openDev, _, _, _) = $0 { true } else { false } }))
}

@Test func noEdgeOrDoubleSeparators() {
    let desks: [DeskStatus] = [.running(version: "a"), .starting, .stopped(reason: nil), .dockerDown, .failed("x")]
    for d in desks {
        for c in [ClipboardState.inaccessible(link), .deskStopped(link)] {
            let m = menu(desk: d, clipboard: c)
            #expect(m.first != .separator && m.last != .separator)
            #expect(!zip(m, m.dropFirst()).contains { $0 == .separator && $1 == .separator })
        }
    }
}

@Test func onlyARespondingDeskIsRunning() {
    #expect(DeskStatus.running(version: "a1b2c3d").isRunning)
    for d in [DeskStatus.starting, .stopped(reason: nil), .dockerDown, .failed("x")] { #expect(!d.isRunning) }
}

@Test func iconStates() {
    #expect(iconState(desk: .starting, update: .upToDate) == .busy)
    for d in [DeskStatus.stopped(reason: nil), .dockerDown, .failed("x")] { #expect(iconState(desk: d, update: .upToDate) == .problem) }
    #expect(iconState(desk: .running(version: "a"), update: .available(commits: 2)) == .updateAvailable)
    #expect(iconState(desk: .running(version: "a"), update: .upToDate) == .normal)
    #expect(iconState(desk: .running(version: "a"), update: .blocked(.dirty)) == .normal)
}

@Test func noticeKeepsTheUpdateActionAndFollowsIt() {
    let m = menu(update: .available(commits: 2), foreign: true, notice: .updateFailed("conflit"))
    #expect(Array(m[2...6]) == [
        .info("Nouvelle version", detail: "2 commits"),
        .action(.update, title: "Mettre à jour et redémarrer", bold: false, enabled: true),
        .action(.showChanges, title: "Voir les changements…", bold: false, enabled: true),
        .info("Échec de la mise à jour : conflit", detail: nil),
        .info("Ce clone suit un autre dépôt que Villeco-inc/pr-review-desk", detail: nil),
    ])
}

@Test func noticeWordings() {
    #expect(menu(notice: .stopFailed("délai dépassé"))[3] == .info("Échec de l'arrêt du Desk : délai dépassé", detail: nil))
    #expect(menu(desk: .stopped(reason: nil), notice: .terminalFailed("refusé")).prefix(4) == [
        .header("PR REVIEW DESK"), .info("Desk arrêté", detail: nil), .action(.start, title: "Démarrer", bold: true, enabled: true),
        .info("Impossible d'ouvrir Terminal : refusé", detail: nil)])
    #expect(menu(notice: .repoNoLongerFollowed)[3] == .info("Ce dépôt n'est plus suivi : rouvre le menu pour le suivre", detail: nil))
    #expect(menu(notice: .message("La review n'a pas pu démarrer : GitHub ne répond pas"))[3]
        == .info("La review n'a pas pu démarrer : GitHub ne répond pas", detail: nil))
}

@Test func pendingCheckShowsVersionWithoutClaimingUpToDate() {
    #expect(menu(update: .checkPending)[2] == .info("Version a1b2c3d", detail: nil))
    #expect(menu(update: .checkPending)[3] == .separator)
    #expect(!menu(desk: .stopped(reason: nil), update: .checkPending).contains(where: { if case .info(let t, _) = $0 { t.hasPrefix("Version") } else { false } }))
    #expect(iconState(desk: .running(version: "a"), update: .checkPending) == .normal)
}

@Test func clipboardLinkWhileDeskStoppedShowsAGreyedReviewEntry() {
    #expect(menu(desk: .stopped(reason: nil), clipboard: .deskStopped(link)).prefix(4) == [
        .header("LIEN EN PRESSE-PAPIER"),
        .action(.clipboardReview(link, follow: false), title: "Lancer la review de Villeco-inc/linea-web#123", bold: false, enabled: false),
        .separator, .header("PR REVIEW DESK")])
}

@Test func changesEntryGreyedWithoutABase() {
    let m = menu(desk: .stopped(reason: nil), update: .available(commits: 2), canShowChanges: false)
    #expect(m.contains(.action(.showChanges, title: "Voir les changements…", bold: false, enabled: false)))
    #expect(m.contains(.action(.update, title: "Mettre à jour et redémarrer", bold: false, enabled: true)))
}

private let updating = JobProgress(kind: .update, step: .fetching)

@Test func busyGreysActionsButKeepsOpeningLogsAndQuit() {
    let m = menu(update: .available(commits: 2), clipboard: .ready(link, title: "T", review: .none, followed: true), job: updating)
    let enabled = m.compactMap { item -> String? in
        if case let .action(_, title, _, true) = item { return title }
        return nil
    }
    #expect(enabled == ["Ouvrir le Desk", "Ouvrir le Dev", "Voir les journaux…", "Quitter"])
    #expect(m.contains(.toggle(.toggleLaunchAtLogin, title: "Lancer au démarrage du Mac", on: true)))
    #expect(menu(desk: .stopped(reason: nil), job: updating).contains(.action(.start, title: "Démarrer", bold: true, enabled: false)))
}

@Test func openDeskHasCommandO() {
    #expect(keyEquivalent(.openDesk) == "o")
    #expect(keyEquivalent(.quit) == nil)
}

@Test func missingCloneLeavesNoActionOnTheClone() {
    let m = withoutCloneActions(menu(desk: .failed("Clone introuvable : /x"), dev: .stopped))
    let actions = m.compactMap { item -> MenuAction? in
        if case let .action(a, _, _, _) = item { return a }
        return nil
    }
    #expect(actions == [.openDesk, .quit])
}
