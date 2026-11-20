import AppKit
import DeskCore

/// Section « Lien en presse-papier » : à chaque ouverture du menu, lit le presse-papier une fois, vérifie la PR
/// auprès du Desk, puis lance ou ouvre la review au clic. Les résultats valent pour une ouverture du menu.
@MainActor
final class ClipboardReview {
    private(set) var state: ClipboardState = .none
    var onChange: () -> Void = {}
    var onNotice: (MenuNotice) -> Void = { _ in }
    let notifier = Notifier()

    private var cache: [PullRequestLink: ClipboardState] = [:]
    /// Change à chaque lecture du presse-papier : une vérification plus ancienne ne touche plus l'état.
    private var generation = 0
    private var checking: PullRequestLink?

    func menuOpened(port: Int, deskRunning: Bool) {
        let link = NSPasteboard.general.string(forType: .string).flatMap(parsePullRequestLink)
        guard let link else { return show(.none) }
        guard deskRunning else { return show(.deskStopped(link)) }
        if let cached = cache[link] { return show(cached) }
        if checking == link { return }
        show(.checking(link))
        checking = link
        let current = generation
        Task {
            let client = DeskClient(port: port)
            async let pullRequest = client.pullRequest(link)
            async let followedRepos = client.followedRepos()
            let result = clipboardCheckResult(link, pullRequest: await pullRequest, followedRepos: await followedRepos)
            guard current == generation else { return }
            checking = nil
            if let result { cache[link] = result }
            state = result ?? .none
            onChange()
        }
    }

    /// Un résultat qui arrive après la fermeture ne s'affiche pas dans le menu suivant.
    func menuClosed() {
        cache.removeAll()
        generation += 1
        checking = nil
    }

    func review(_ link: PullRequestLink, follow: Bool, port: Int) {
        cache[link] = nil
        Task {
            do {
                let outcome = try await DeskClient(port: port).startReview(link, follow: follow)
                openTab(link, port: port)
                if outcome == .unchanged { notifier.post("Aucun nouveau commit depuis la dernière review") }
            } catch let error as DeskClientError where error.code == "not-followed" {
                onNotice(.repoNoLongerFollowed)
            } catch {
                notifier.post("La review n'a pas pu démarrer : \(error.localizedDescription)")
            }
        }
    }

    func openTab(_ link: PullRequestLink, port: Int) {
        if let url = URL(string: "http://localhost:\(port)/prs/\(link.owner)/\(link.repo)/\(link.number)") { NSWorkspace.shared.open(url) }
    }

    private func show(_ new: ClipboardState) {
        generation += 1
        checking = nil
        state = new
        onChange()
    }
}
