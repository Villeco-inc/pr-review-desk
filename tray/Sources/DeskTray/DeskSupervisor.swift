import AppKit
import DeskCore

/// Surveille le Desk, Docker, le mode dev et le clone, et exécute les actions du menu, une à la fois.
/// Tout l'état vit sur le MainActor ; Shell et HTTP tournent dans des tâches, jamais sur le fil principal.
@MainActor
final class DeskSupervisor {
    private static let devPort = 5173
    private static let gitEnv = ["GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes"]

    var onChange: () -> Void = {}
    /// Hook de développement (`DESK_TRAY_DUMP=1`) : une ligne par décision de sondage.
    var trace: ((String) -> Void)?

    private let config: TrayConfig?
    private var desk: DeskStatus = .starting {
        // La section presse-papier dépend du Desk (grisée tant qu'il est arrêté) : menu ouvert, elle suit son retour.
        didSet { if menuOpen, oldValue.isRunning != desk.isRunning { readClipboard() } }
    }
    private var dev: DevStatus = .stopped
    private var facts: CloneFacts?
    /// Échec d'une action à montrer dans le menu ; effacé quand une nouvelle action commence.
    private var notice: MenuNotice?
    private var port = defaultHostPort
    private var launchAtLogin = LaunchAtLogin.isEnabled
    private let clipboard = ClipboardReview()
    /// Hook de développement uniquement (`DESK_TRAY_CLIPBOARD_EACH_POLL=1`) : chaque sondage relit le presse-papier
    /// comme une ouverture du menu, pour vérifier la section sans cliquer sur l'icône.
    private let clipboardEachPoll = ProcessInfo.processInfo.environment["DESK_TRAY_CLIPBOARD_EACH_POLL"] == "1"
    /// L'action en cours et son étape ; une seule à la fois.
    private var job: JobProgress?
    private var busy: Bool { job != nil }
    private var menuOpen = false
    private var polling = false
    private var checkingUpdates = false
    /// « Arrêter » cliqué dans cette session : le tray ne relance plus le Desk de lui-même.
    private var stoppedByUser = false
    /// `start.sh` a échoué : on garde `.failed` au lieu de le relancer à chaque sondage, jusqu'à une action,
    /// un retour de Docker ou un Desk qui répond.
    private var startFailed = false
    private var dockerWasDown = false
    private var dockerBackAt: Date?
    private var consecutiveMisses = 0
    /// Vérification des mises à jour demandée pendant une action : faite dès qu'elle finit.
    private var updateCheckPending = false
    /// Change au début et à la fin de chaque action : un sondage qui en chevauche une ne touche pas à l'état du Desk.
    private var jobEpoch = 0
    private var lastPoll = Date.distantPast
    private var lastUpdateCheck = Date.distantPast
    private var loop: Task<Void, Never>?

    init(config: TrayConfig?) {
        self.config = config
        clipboard.onChange = { [weak self] in self?.onChange() }
        clipboard.onNotice = { [weak self] in self?.show($0) }
        clipboard.notifier.fallback = { [weak self] in self?.show(.message($0)) }
    }

    var items: [MenuItem] {
        let all = buildMenu(desk: desk, dev: dev, update: update, clipboard: clipboard.state, launchAtLogin: launchAtLogin, port: port,
                            foreignRemote: facts.map { !$0.isReferenceRemote } ?? false, notice: notice,
                            canShowChanges: changesBase(running: runningVersion, head: facts?.head) != nil, job: job)
        return config == nil || cloneMissing ? withoutCloneActions(all) : all
    }

    /// Le dossier du clone a été déplacé ou supprimé depuis l'installation.
    private var cloneMissing: Bool {
        guard let clone = config?.clonePath else { return false }
        var isDirectory: ObjCBool = false
        return !FileManager.default.fileExists(atPath: clone, isDirectory: &isDirectory) || !isDirectory.boolValue
    }

    var icon: IconState { busy ? .busy : iconState(desk: desk, update: update) }

    private var update: UpdateState {
        guard let facts else { return .checkPending }
        return updateState(running: runningVersion, facts: facts)
    }

    private var runningVersion: String? {
        if case let .running(version) = desk { return version }
        return nil
    }

    func start() {
        guard config != nil else {
            desk = .failed("Tray non configuré : lance ./start.sh --tray dans le clone du Desk")
            onChange()
            return
        }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.tick()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    func stop() { loop?.cancel() }

    func setMenuOpen(_ open: Bool) {
        menuOpen = open
        if open { Task { await poll() } } else { clipboard.menuClosed() }
    }

    /// Appelé juste avant l'affichage du menu : la section presse-papier y est encore modifiable.
    func readClipboard() {
        clipboard.menuOpened(port: port, deskRunning: runningVersion != nil)
    }

    func checkUpdatesNow() { Task { await checkUpdates() } }

    func perform(_ action: MenuAction) {
        let clone = config?.clonePath
        switch action {
        case .openDesk: open("http://localhost:\(port)")
        case .openDev: open("http://localhost:\(Self.devPort)")
        case .showChanges:
            if let base = changesBase(running: runningVersion, head: facts?.head) {
                open("https://github.com/Villeco-inc/pr-review-desk/compare/\(base)...main")
            }
        case .checkDocker: Task { await poll() }
        case .toggleLaunchAtLogin: toggleLaunchAtLogin()
        case .quit: NSApp.terminate(nil)
        case let .clipboardReview(link, follow):
            clearClipboardNotice()
            clipboard.review(link, follow: follow, port: port)
        case let .clipboardOpen(link): clipboard.openTab(link, port: port)
        case .showLogs: if let clone { terminal("docker compose logs -f app", in: clone) }
        case .openStartScriptInTerminal: if let clone { terminal("./start.sh", in: clone) }
        case .start: if let clone { run(.start, stoppedByUser: false) { await $0.startAndReinstallTray(clone) } }
        case .rebuild: if let clone { run(.rebuild, stoppedByUser: false) { await $0.startAndReinstallTray(clone) } }
        case .restart: if let clone { run(.restart, stoppedByUser: false) { await $0.restartApp(clone) } }
        case .update: if let clone { run(.update, stoppedByUser: false) { await $0.updateDesk(clone) } }
        case .stop: if let clone { run(.stop, stoppedByUser: true) { await $0.stopApp(clone) } }
        }
    }

    // MARK: - Sondage

    private func tick() async {
        let now = Date()
        if now.timeIntervalSince(lastUpdateCheck) >= 30 * 60 { checkUpdatesNow() }
        let interval: TimeInterval = menuOpen || busy ? 3 : 15
        if now.timeIntervalSince(lastPoll) >= interval { await poll() }
    }

    private func poll() async {
        guard !polling, let clone = config?.clonePath else { return }
        polling = true
        defer { polling = false; lastPoll = Date() }
        // Sans ce test, chaque commande lancée dans un dossier disparu échoue et le tray conclut à un Docker arrêté.
        guard !cloneMissing else {
            desk = .failed("Clone introuvable : \(clone). Lance ./start.sh --tray depuis le clone du Desk")
            facts = nil
            onChange()
            return
        }

        let deskPort = readPort(clone)
        port = deskPort
        let epochBefore = jobEpoch
        async let deskHealth = DeskClient(port: deskPort).health()
        async let devHealth = DeskClient(port: 3100).health()
        async let dockerInfo = Shell.run("docker", ["info"], cwd: NSHomeDirectory(), timeout: 10)
        let (health, devDTO, dockerUp) = await (deskHealth, devHealth, dockerInfo.code == 0)

        dev = devDTO?.mode == "dev" ? .running(port: Self.devPort) : .stopped
        if clipboardEachPoll { clipboard.menuOpened(port: deskPort, deskRunning: health != nil) }
        // Pendant une action, c'est elle qui décide de l'état du Desk.
        guard !busy, jobEpoch == epochBefore else { onChange(); return }

        if let health {
            startFailed = false
            consecutiveMisses = 0
            dockerWasDown = false
            dockerBackAt = nil
            desk = .running(version: health.version)
        } else if !dockerUp {
            dockerWasDown = true
            consecutiveMisses = 0
        } else {
            consecutiveMisses += 1
            if dockerWasDown {
                dockerWasDown = false
                dockerBackAt = Date()
                startFailed = false
            }
        }
        let step = nextStartStep(dockerUp: dockerUp, deskHealthy: health != nil, stoppedByUser: stoppedByUser,
                                 consecutiveMisses: consecutiveMisses, secondsSinceDockerBack: dockerBackAt.map { Date().timeIntervalSince($0) })
        trace?("poll healthy=\(health != nil) docker=\(dockerUp) misses=\(consecutiveMisses) step=\(step)")
        switch step {
        case .dockerDown:
            desk = .dockerDown
        case .done:
            if health == nil { desk = .stopped(reason: nil) }
        case .wait:
            // Docker vient de revenir : le conteneur redémarre en principe de lui-même.
            if desk == .dockerDown { desk = .starting }
        case .runStartScript:
            if !startFailed {
                // Au lancement, l'état est déjà « Démarrage » : pas d'« arrêté » rouge entre les deux.
                if desk != .starting {
                    desk = .stopped(reason: nil)
                    onChange()
                }
                dockerBackAt = nil
                run(.start, stoppedByUser: false) { await $0.startScript(clone) }
            }
        }
        onChange()
    }

    private func checkUpdates() async {
        guard !checkingUpdates, !cloneMissing, let clone = config?.clonePath else { return }
        guard !busy else { updateCheckPending = true; return }
        checkingUpdates = true
        lastUpdateCheck = Date()
        defer { checkingUpdates = false }
        facts = await CloneInspector(path: clone).facts(runningCommit: runningVersion)
        onChange()
    }

    // MARK: - Actions

    /// Lance une action si aucune ne tourne ; un clic pendant une action est ignoré.
    private func run(_ kind: JobKind, stoppedByUser: Bool, _ work: @escaping @MainActor (DeskSupervisor) async -> Void) {
        guard !busy else { return }
        job = JobProgress(kind: kind, step: .preparing)
        jobEpoch += 1
        self.stoppedByUser = stoppedByUser
        notice = nil
        onChange()
        Task {
            await work(self)
            jobEpoch += 1
            consecutiveMisses = 0
            job = nil
            lastPoll = .distantPast
            onChange()
            if updateCheckPending {
                updateCheckPending = false
                checkUpdatesNow()
            }
        }
    }

    @discardableResult
    private func startScript(_ clone: String) async -> Bool {
        desk = .starting
        job?.step = .preparing
        onChange()
        let startedAt = Date()
        let watcher = Task { [weak self] in
            while !Task.isCancelled {
                let progress = await Self.buildProgress(clone: clone, since: startedAt)
                if !Task.isCancelled, let progress { self?.step(.building(progress)) }
                try? await Task.sleep(for: .seconds(1))
            }
        }
        let r = await Shell.run("./start.sh", ["--no-prompt"], cwd: clone, timeout: 15 * 60)
        watcher.cancel()
        guard r.code == 0 else {
            fail(r.code == Shell.timeoutCode ? "start.sh n'a pas fini en 15 min" : startFailureMessage(output: r.out, code: r.code))
            return false
        }
        return await waitUntilHealthy(clone)
    }

    /// « Démarrer » et « Reconstruire » : le clone a pu changer (git pull à la main), le tray se reconstruit comme après « Mettre à jour ».
    private func startAndReinstallTray(_ clone: String) async {
        guard await startScript(clone) else { return }
        await reinstallTrayIfChanged(clone)
    }

    private func restartApp(_ clone: String) async {
        desk = .starting
        onChange()
        let r = await Shell.run("docker", ["compose", "restart", "app"], cwd: clone, timeout: 2 * 60)
        guard r.code == 0 else { return fail(lastLine(r.out) ?? "docker compose restart a échoué (code \(r.code))") }
        await waitUntilHealthy(clone)
    }

    private func stopApp(_ clone: String) async {
        let r = await Shell.run("docker", ["compose", "stop", "app"], cwd: clone, timeout: 2 * 60)
        if r.code == 0 {
            desk = .stopped(reason: nil)
        } else {
            stoppedByUser = false
            notice = .stopFailed(failureCause(r, timeout: "2 min"))
        }
    }

    private func updateDesk(_ clone: String) async {
        while checkingUpdates { try? await Task.sleep(for: .milliseconds(200)) }
        step(.fetching)
        let current = await CloneInspector(path: clone).facts(runningCommit: runningVersion)
        facts = current
        guard current.fetchError == nil, updateBlockReason(current) == nil else { return }

        let pull = await Shell.run("git", ["pull", "--ff-only", "origin", "main"], cwd: clone, env: Self.gitEnv, timeout: 2 * 60)
        guard pull.code == 0 else {
            notice = .updateFailed("git pull : \(failureCause(pull, timeout: "2 min"))")
            return
        }
        guard await startScript(clone) else { return }
        facts = await CloneInspector(path: clone).facts(runningCommit: runningVersion)
        await reinstallTrayIfChanged(clone)
    }

    /// `tray/install.sh` lance le tray neuf (par launchd, ou `open -n` sans LaunchAgent), qui termine celui-ci ;
    /// ce tray se retire de toute façon. install.sh tourne dans sa propre session : launchd, en tuant le tray
    /// et son groupe (`kickstart -k`), ne l'interrompt pas.
    private func reinstallTrayIfChanged(_ clone: String) async {
        guard let config, FileManager.default.fileExists(atPath: "\(clone)/tray/install.sh") else { return }
        let tree = await Shell.run("git", ["rev-parse", "HEAD:tray"], cwd: clone, env: ["GIT_OPTIONAL_LOCKS": "0"], timeout: 15)
        let head = tree.out.trimmingCharacters(in: .whitespacesAndNewlines)
        guard tree.code == 0, head != config.trayTree else { return }
        step(.rebuildingApp)
        let install = await Shell.runInOwnSession("tray/install.sh", [clone], cwd: clone, timeout: 15 * 60)
        guard install.code == 0 else {
            notice = .updateFailed("tray/install.sh : \(failureCause(install, timeout: "15 min"))")
            return
        }
        NSApp.terminate(nil)
    }

    private func toggleLaunchAtLogin() {
        let failure = launchAtLogin ? LaunchAtLogin.disable() : LaunchAtLogin.enable()
        launchAtLogin = LaunchAtLogin.isEnabled
        if let failure { notice = .message("Lancer au démarrage du Mac : \(failure)") }
        onChange()
    }

    private func step(_ new: JobStep) {
        guard job != nil, job?.step != new else { return }
        job?.step = new
        onChange()
    }

    private func show(_ new: MenuNotice?) {
        notice = new
        onChange()
    }

    private func clearClipboardNotice() {
        switch notice {
        case .repoNoLongerFollowed, .message: show(nil)
        default: break
        }
    }

    /// `start.sh` rend la main dès `docker compose up -d` : le serveur met quelques secondes à répondre.
    @discardableResult
    private func waitUntilHealthy(_ clone: String) async -> Bool {
        step(.waitingForDesk)
        let deadline = Date().addingTimeInterval(90)
        while Date() < deadline {
            port = readPort(clone)
            if let health = await DeskClient(port: port).health() {
                desk = .running(version: health.version)
                startFailed = false
                return true
            }
            try? await Task.sleep(for: .seconds(2))
        }
        fail("Le Desk ne répond pas après son démarrage")
        return false
    }

    private func fail(_ message: String) {
        desk = .failed(message)
        startFailed = true
    }

    // MARK: - Outils

    /// Avancement de la construction lancée par `start.sh` ; un journal plus ancien que l'action est celui d'un lancement précédent.
    private nonisolated static func buildProgress(clone: String, since: Date) async -> BuildProgress? {
        await Task.detached {
            let path = "\(clone)/.desk/start.log"
            guard let modified = (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date, modified >= since,
                  let data = FileManager.default.contents(atPath: path) else { return nil }
            let planned = (try? String(contentsOfFile: "\(clone)/Dockerfile", encoding: .utf8)).map(dockerfileSteps)
            return parseBuildProgress(String(decoding: data, as: UTF8.self), plannedSteps: planned)
        }.value
    }

    private func readPort(_ clone: String) -> Int {
        readHostPort(envFile: try? String(contentsOfFile: "\(clone)/.env", encoding: .utf8))
    }

    private func lastLine(_ out: String) -> String? {
        out.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.last { !$0.isEmpty }
    }

    private func failureCause(_ r: (code: Int32, out: String), timeout: String) -> String {
        r.code == Shell.timeoutCode ? "délai de \(timeout) dépassé" : lastLine(r.out) ?? "code \(r.code)"
    }

    private func open(_ link: String) {
        if let url = URL(string: link) { NSWorkspace.shared.open(url) }
    }

    /// Ouvre Terminal sur `cd '<clone>' && <commande>` ; la commande passe en argument d'osascript, jamais dans le script.
    private func terminal(_ command: String, in clone: String) {
        let quoted = "'" + clone.replacingOccurrences(of: "'", with: "'\\''") + "'"
        let script = ["on run argv", "tell application \"Terminal\"", "activate", "do script (item 1 of argv)", "end tell", "end run"]
        let args = script.flatMap { ["-e", $0] } + ["cd \(quoted) && \(command)"]
        if case .terminalFailed = notice {
            notice = nil
            onChange()
        }
        Task {
            let r = await Shell.run("osascript", args, cwd: clone, timeout: 30)
            if r.code != 0 {
                notice = .terminalFailed(failureCause(r, timeout: "30 s"))
                onChange()
            }
        }
    }
}
