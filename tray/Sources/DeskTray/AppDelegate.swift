import AppKit
import DeskCore

/// Hooks de développement (sans interface) :
/// - `DESK_TRAY_CONFIG=<fichier>` remplace le config.json réel (voir `TrayConfig.url`) ;
/// - `DESK_TRAY_DUMP=1` écrit sur stdout, à chaque reconstruction du menu, une ligne par entrée et l'icône,
///   et une ligne par décision de sondage ;
/// - `DESK_TRAY_CLIPBOARD_EACH_POLL=1` relit le presse-papier à chaque sondage, comme une ouverture du menu.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let dump = ProcessInfo.processInfo.environment["DESK_TRAY_DUMP"] == "1"
    private var statusItem: NSStatusItem?
    private var menu: StatusMenu?
    private var supervisor: DeskSupervisor?
    private var shown: (items: [MenuItem], icon: IconState)?
    private var wakeObserver: NSObjectProtocol?

    func applicationDidFinishLaunching(_ notification: Notification) {
        terminateOlderInstances()
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        let menu = StatusMenu()
        let supervisor = DeskSupervisor(config: TrayConfig.load())
        item.menu = menu.menu
        menu.onAction = { [weak supervisor] in supervisor?.perform($0) }
        menu.onOpenChange = { [weak supervisor] in supervisor?.setMenuOpen($0) }
        menu.onNeedsUpdate = { [weak supervisor] in supervisor?.readClipboard() }
        supervisor.onChange = { [weak self] in self?.render() }
        if dump { supervisor.trace = { [weak self] in self?.write(["~~~ \(Self.now()) \($0)"]) } }
        statusItem = item
        self.menu = menu
        self.supervisor = supervisor

        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
        ) { [weak supervisor] _ in
            MainActor.assumeIsolated { supervisor?.checkUpdatesNow() }
        }
        render()
        supervisor.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        supervisor?.stop()
        if let wakeObserver { NSWorkspace.shared.notificationCenter.removeObserver(wakeObserver) }
    }

    /// Un seul tray à la fois, et c'est le dernier lancé : chaque lancement (install.sh, launchd, `open -n`)
    /// remplace l'ancien binaire par celui qu'on vient d'installer. Quitter l'ancien n'arrête pas le Desk.
    private func terminateOlderInstances() {
        guard let id = Bundle.main.bundleIdentifier else { return }
        let me = NSRunningApplication.current
        let older = NSRunningApplication.runningApplications(withBundleIdentifier: id).filter {
            isOlderInstance(launched: $0.launchDate, pid: $0.processIdentifier, than: me.launchDate, pid: me.processIdentifier)
        }
        guard !older.isEmpty else { return }
        older.forEach { $0.terminate() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            older.filter { !$0.isTerminated }.forEach { $0.forceTerminate() }
        }
    }

    /// Ne reconstruit le menu que si son contenu ou l'icône a changé.
    private func render() {
        guard let supervisor, let menu, let button = statusItem?.button else { return }
        let items = supervisor.items, icon = supervisor.icon
        if let shown, shown.items == items, shown.icon == icon { return }
        shown = (items, icon)
        menu.show(items)
        button.image = Icon.image(icon)
        if dump { writeDump(items, icon) }
    }

    private func writeDump(_ items: [MenuItem], _ icon: IconState) {
        write(["--- \(Self.now()) icon=\(icon)"] + items.map { "  \($0)" })
    }

    private static func now() -> String { Date().formatted(date: .omitted, time: .standard) }

    private func write(_ lines: [String]) {
        FileHandle.standardOutput.write(Data((lines.joined(separator: "\n") + "\n").utf8))
    }
}
