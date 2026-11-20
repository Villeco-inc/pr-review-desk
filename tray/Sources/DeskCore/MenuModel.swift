import Foundation

public enum DeskStatus: Equatable, Sendable {
    case running(version: String), starting, stopped(reason: String?), dockerDown, failed(String)

    public var isRunning: Bool {
        if case .running = self { return true }
        return false
    }
}

public enum DevStatus: Equatable, Sendable {
    case running(port: Int), stopped
}

/// Où en est la review de la PR copiée, par rapport au commit courant de la PR.
public enum PullRequestReview: Equatable, Sendable {
    /// Aucune review n'a lu un commit connu.
    case none
    case running
    /// La dernière review a lu le commit courant.
    case upToDate
    /// Des commits sont arrivés depuis la dernière review.
    case outdated
}

public enum ClipboardState: Equatable, Sendable {
    case none
    case checking(PullRequestLink)
    /// `followed: false` = dépôt hors de la sélection mais PR lisible (donc suivable).
    case ready(PullRequestLink, title: String, review: PullRequestReview, followed: Bool)
    case inaccessible(PullRequestLink)
    case deskStopped(PullRequestLink)
}

public enum MenuAction: Equatable, Sendable {
    case openDesk, restart, stop, start, checkDocker, update, rebuild, showChanges, openDev
    case showLogs, toggleLaunchAtLogin, quit
    case clipboardReview(PullRequestLink, follow: Bool)
    case clipboardOpen(PullRequestLink)
    case openStartScriptInTerminal
}

public enum MenuItem: Equatable, Sendable {
    case header(String)
    case info(String, detail: String?)
    case action(MenuAction, title: String, bold: Bool, enabled: Bool)
    case toggle(MenuAction, title: String, on: Bool)
    case separator
}

public enum MenuNotice: Equatable, Sendable {
    case updateFailed(String), stopFailed(String), terminalFailed(String)
    case repoNoLongerFollowed
    /// Texte d'une notification macOS impossible à afficher (hors bundle ou refusée).
    case message(String)
}

public enum IconState: Equatable, Sendable {
    case normal, busy, updateAvailable, problem
}

private func blockCause(_ b: UpdateBlock) -> String {
    switch b {
    case .dirty: "le clone n'est pas propre"
    case .notOnMain: "le clone n'est pas sur main"
    case .notMainClone: "ce dossier n'est pas le clone principal"
    case .diverged: "main a divergé d'origin"
    }
}

private func clipboardSection(_ clipboard: ClipboardState, deskRunning: Bool) -> [MenuItem] {
    switch clipboard {
    case .none, .checking:
        return []
    case let .deskStopped(link):
        // Le tray ne peut pas interroger un Desk arrêté : ni titre ni état de suivi.
        return [.header("LIEN EN PRESSE-PAPIER"),
                .action(.clipboardReview(link, follow: false), title: "Lancer la review de \(link.slug)", bold: false, enabled: false)]
    case let .inaccessible(link):
        return [.header("LIEN EN PRESSE-PAPIER"), .info("PR inaccessible : \(link.slug)", detail: nil)]
    case let .ready(link, title, review, followed):
        let entry: MenuItem
        var detail: String?
        switch review {
        case .running:
            entry = .action(.clipboardOpen(link), title: "Ouvrir la review en cours de \(link.slug)", bold: false, enabled: deskRunning)
        case .upToDate:
            entry = .action(.clipboardOpen(link), title: "Ouvrir la review de \(link.slug)", bold: false, enabled: deskRunning)
            detail = "review à jour"
        case .none, .outdated:
            let verb = review == .outdated ? "Relancer" : "Lancer"
            entry = followed
                ? .action(.clipboardReview(link, follow: false), title: "\(verb) la review de \(link.slug)", bold: false, enabled: deskRunning)
                : .action(.clipboardReview(link, follow: true), title: "Suivre \(link.owner)/\(link.repo) et lancer la review", bold: false, enabled: deskRunning)
            if review == .outdated { detail = "nouveaux commits depuis la review" }
        }
        return [.header("LIEN EN PRESSE-PAPIER"), entry, .info(title, detail: detail)]
    }
}

private func updateBlock(_ update: UpdateState, running: String?, canShowChanges: Bool) -> [MenuItem] {
    switch update {
    case .upToDate:
        return running.map { [.info("Version \($0) · à jour", detail: nil)] } ?? []
    case .checkPending:
        return running.map { [.info("Version \($0)", detail: nil)] } ?? []
    case let .available(n):
        return [
            .info("Nouvelle version", detail: n == 1 ? "1 commit" : "\(n) commits"),
            .action(.update, title: "Mettre à jour et redémarrer", bold: false, enabled: true),
            .action(.showChanges, title: "Voir les changements…", bold: false, enabled: canShowChanges),
        ]
    case .rebuildNeeded:
        guard let running else { return [] }
        return [.info("Version \(running)", detail: nil), .action(.rebuild, title: "Reconstruire", bold: false, enabled: true)]
    case let .checkFailed(cause):
        return [.info("Vérification des mises à jour impossible", detail: cause)]
    case let .blocked(b):
        return [.info("⚠ Mise à jour bloquée : \(blockCause(b))", detail: nil)]
    }
}

private func noticeText(_ n: MenuNotice) -> String {
    switch n {
    case let .updateFailed(cause): "Échec de la mise à jour : \(cause)"
    case let .stopFailed(cause): "Échec de l'arrêt du Desk : \(cause)"
    case let .terminalFailed(cause): "Impossible d'ouvrir Terminal : \(cause)"
    case .repoNoLongerFollowed: "Ce dépôt n'est plus suivi : rouvre le menu pour le suivre"
    case let .message(text): text
    }
}

private func start(bold: Bool) -> MenuItem { .action(.start, title: "Démarrer", bold: bold, enabled: true) }

public func buildMenu(desk: DeskStatus, dev: DevStatus, update: UpdateState, clipboard: ClipboardState,
                      launchAtLogin: Bool, port: Int, foreignRemote: Bool, notice: MenuNotice? = nil,
                      canShowChanges: Bool = true, job: JobProgress? = nil) -> [MenuItem] {
    var running: String?
    if case let .running(version) = desk { running = version }
    let isRunning = running != nil

    var items = clipboardSection(clipboard, deskRunning: isRunning)
    if !items.isEmpty { items.append(.separator) }
    items.append(.header("PR REVIEW DESK"))
    if let job { items.append(jobLine(job)) }

    switch desk {
    case .running:
        items.append(.info("Desk en marche", detail: ":\(port)"))
        items += updateBlock(update, running: running, canShowChanges: canShowChanges)
    case .starting:
        if job == nil { items.append(.info("Démarrage du Desk…", detail: nil)) }
    case let .stopped(reason):
        items += [.info("Desk arrêté", detail: reason), start(bold: true)]
    case .dockerDown:
        items += [.info("Docker n'est pas démarré", detail: nil),
                  .action(.checkDocker, title: "Vérifier si Docker est démarré", bold: true, enabled: true)]
    case let .failed(message):
        items += [.info("Le Desk n'a pas démarré", detail: message),
                  .action(.openStartScriptInTerminal, title: "Ouvrir un Terminal sur ./start.sh", bold: true, enabled: true),
                  start(bold: false)]
    }
    if !isRunning {
        switch update {
        case .available, .checkFailed, .blocked: items += updateBlock(update, running: nil, canShowChanges: canShowChanges)
        default: break
        }
    }
    if let notice { items.append(.info(noticeText(notice), detail: nil)) }
    if foreignRemote {
        items.append(.info("Ce clone suit un autre dépôt que Villeco-inc/pr-review-desk", detail: nil))
    }

    items += [.separator, .action(.openDesk, title: "Ouvrir le Desk", bold: false, enabled: isRunning)]
    if isRunning {
        items += [.action(.restart, title: "Redémarrer", bold: false, enabled: true),
                  .action(.stop, title: "Arrêter", bold: false, enabled: true)]
    }

    items += [.separator, .header("MODE DEV")]
    switch dev {
    case let .running(devPort):
        items += [.info("Dev en marche", detail: ":\(devPort)"),
                  .action(.openDev, title: "Ouvrir le Dev", bold: false, enabled: true)]
    case .stopped:
        items.append(.info("Dev arrêté", detail: nil))
    }

    items += [.separator,
              .action(.showLogs, title: "Voir les journaux…", bold: false, enabled: true),
              .toggle(.toggleLaunchAtLogin, title: "Lancer au démarrage du Mac", on: launchAtLogin),
              .action(.quit, title: "Quitter", bold: false, enabled: true)]
    return job != nil ? items.map(greyedWhileBusy) : items
}

/// Pendant une action, un clic sur une autre serait ignoré : l'entrée est grisée plutôt que muette.
private func greyedWhileBusy(_ item: MenuItem) -> MenuItem {
    guard case let .action(action, title, bold, _) = item else { return item }
    switch action {
    case .openDesk, .openDev, .showLogs, .quit: return item
    default: return .action(action, title: title, bold: bold, enabled: false)
    }
}

public func iconState(desk: DeskStatus, update: UpdateState) -> IconState {
    switch desk {
    case .starting: return .busy
    case .stopped, .dockerDown, .failed: return .problem
    case .running:
        if case .available = update { return .updateAvailable }
        return .normal
    }
}

/// Raccourci (avec ⌘) d'une entrée du menu.
public func keyEquivalent(_ action: MenuAction) -> String? {
    action == .openDesk ? "o" : nil
}

/// Sans clone utilisable (pas de config.json, dossier déplacé ou supprimé), les entrées qui agissent dessus disparaissent.
public func withoutCloneActions(_ items: [MenuItem]) -> [MenuItem] {
    items.filter {
        guard case let .action(action, _, _, _) = $0 else { return true }
        switch action {
        case .start, .restart, .stop, .update, .rebuild, .showLogs, .openStartScriptInTerminal, .checkDocker: return false
        default: return true
        }
    }
}
