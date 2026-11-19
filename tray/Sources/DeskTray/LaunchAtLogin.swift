import Foundation

/// « Lancer au démarrage du Mac » : la case est cochée quand le LaunchAgent existe. La case ne touche qu'au fichier,
/// jamais à launchctl : le changement vaut à la prochaine ouverture de session (un job déjà chargé, KeepAlive faux,
/// ne relance rien). Même plist que tray/install.sh (RunAtLoad vrai, KeepAlive faux, l'exécutable de l'app installée).
enum LaunchAtLogin {
    static let label = "com.villeco.pr-review-desk.tray"
    static let appPath = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications/PR Review Desk.app").path

    private static var agentURL: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents/\(label).plist")
    }

    static var isEnabled: Bool { FileManager.default.fileExists(atPath: agentURL.path) }

    /// Rend la cause d'un échec.
    static func enable() -> String? {
        let plist: [String: Any] = [
            "Label": label,
            "ProgramArguments": ["\(appPath)/Contents/MacOS/DeskTray"],
            "RunAtLoad": true,
            "KeepAlive": false,
        ]
        do {
            let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
            try FileManager.default.createDirectory(at: agentURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: agentURL, options: .atomic)
            return nil
        } catch {
            return "écriture du LaunchAgent impossible : \(error.localizedDescription)"
        }
    }

    static func disable() -> String? {
        do {
            try FileManager.default.removeItem(at: agentURL)
            return nil
        } catch {
            return "suppression du LaunchAgent impossible : \(error.localizedDescription)"
        }
    }
}
