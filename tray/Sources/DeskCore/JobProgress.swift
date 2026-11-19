import Foundation

/// L'action du menu en cours d'exécution.
public enum JobKind: Equatable, Sendable {
    case update, restart, start, rebuild, stop
}

public enum BuildTarget: Equatable, Sendable {
    /// L'image Docker du Desk (BuildKit).
    case image
    /// Le tray lui-même (SwiftPM).
    case app
}

public struct BuildProgress: Equatable, Sendable {
    public let target: BuildTarget
    public let done: Int
    public let total: Int

    public init(target: BuildTarget, done: Int, total: Int) {
        self.target = target
        self.done = done
        self.total = total
    }
}

public enum JobStep: Equatable, Sendable {
    case preparing, fetching, building(BuildProgress), waitingForDesk, rebuildingApp
}

public struct JobProgress: Equatable, Sendable {
    public let kind: JobKind
    public var step: JobStep

    public init(kind: JobKind, step: JobStep) {
        self.kind = kind
        self.step = step
    }
}

/// Avancement lu dans `.desk/start.log`, comme le fait `start.sh` pour sa propre ligne animée : les lignes BuildKit
/// « #N [étape n/m] … » (n complété par des espaces à la largeur de m ; les étapes vues s'additionnent) ou SwiftPM
/// « [n/m] … ». La dernière de ces lignes dit ce qui se construit. Aucun compteur encore : `nil`.
/// BuildKit ne donne le nombre d'étapes d'un stage qu'en l'abordant : `plannedSteps` (voir `dockerfileSteps`) fixe le total
/// dès le début, pour que la barre n'aille pas de 100 % à 50 % quand le stage suivant commence.
public func parseBuildProgress(_ log: String, plannedSteps: Int? = nil) -> BuildProgress? {
    var stageTotals: [String: Int] = [:], stageDone: [String: Int] = [:]
    var swiftPM: BuildProgress?
    var last: BuildTarget?
    for line in log.split(whereSeparator: \.isNewline) {
        if let m = line.wholeMatch(of: /#\d+ \[(.*?) *(\d+)\/(\d+)\].*/), let n = Int(m.2), let total = Int(m.3) {
            let stage = String(m.1)
            if stageTotals[stage] == nil { stageTotals[stage] = total }
            stageDone[stage] = max(stageDone[stage] ?? 0, n)
            last = .image
        } else if let m = line.wholeMatch(of: /\[(\d+)\/(\d+)\].*/), let n = Int(m.1), let total = Int(m.2) {
            swiftPM = BuildProgress(target: .app, done: n, total: total)
            last = .app
        }
    }
    let progress: BuildProgress? = switch last {
    case .image: BuildProgress(target: .image, done: stageDone.values.reduce(0, +),
                               total: max(stageTotals.values.reduce(0, +), plannedSteps ?? 0))
    case .app: swiftPM
    case nil: nil
    }
    guard let progress, progress.total > 0 else { return nil }
    return BuildProgress(target: progress.target, done: min(progress.done, progress.total), total: progress.total)
}

/// La ligne du menu pendant une action : son nom, et l'étape en détail.
func jobLine(_ job: JobProgress) -> MenuItem {
    let title = switch job.kind {
    case .update: "Mise à jour en cours…"
    case .restart: "Redémarrage en cours…"
    case .start: "Démarrage en cours…"
    case .rebuild: "Reconstruction en cours…"
    case .stop: "Arrêt en cours…"
    }
    let detail: String? = switch job.step {
    case .preparing: nil
    case .fetching: "récupération des changements"
    case let .building(p): "\(p.target == .image ? "construction de l'image" : "compilation de l'app") \(bar(p)) \(p.done)/\(p.total) · \(p.done * 100 / p.total) %"
    case .waitingForDesk: "démarrage du Desk"
    case .rebuildingApp: "reconstruction de l'app"
    }
    return .info(title, detail: detail)
}

private func bar(_ p: BuildProgress) -> String {
    let filled = p.done * 10 / p.total
    return String(repeating: "█", count: filled) + String(repeating: "░", count: 10 - filled)
}

/// Nombre d'étapes que BuildKit numérote (`[stage n/m]`) pour ce Dockerfile, tous stages confondus.
/// Un stage que la cible n'utilise pas est compté quand même : la barre s'arrête alors avant 100 %.
public func dockerfileSteps(_ dockerfile: String) -> Int {
    let numbered: Set<String> = ["FROM", "RUN", "COPY", "ADD", "WORKDIR"]
    return dockerfile.split(whereSeparator: \.isNewline).count { line in
        guard let first = line.first, !first.isWhitespace else { return false }
        return numbered.contains(line.prefix { !$0.isWhitespace }.uppercased())
    }
}
