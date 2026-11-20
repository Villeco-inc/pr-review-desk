import Foundation

/// Configuration écrite par tray/install.sh (`clonePath`, `trayTree`) et lue par le tray.
struct TrayConfig: Decodable, Equatable {
    let clonePath: String
    let trayTree: String

    /// Hook de développement : `DESK_TRAY_CONFIG=<fichier>` remplace le config.json réel (essais sur un clone jetable).
    static var url: URL {
        if let path = ProcessInfo.processInfo.environment["DESK_TRAY_CONFIG"], !path.isEmpty {
            return URL(fileURLWithPath: path)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/PR Review Desk/config.json")
    }

    static func load() -> TrayConfig? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(TrayConfig.self, from: data)
    }
}
