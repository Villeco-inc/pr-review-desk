import Foundation

public enum StartStep: Equatable, Sendable { case dockerDown, runStartScript, wait, done }

/// Délai laissé au conteneur (`restart: unless-stopped`) pour revenir de lui-même quand Docker redémarre.
public let dockerBackGrace: Double = 30

/// Ce que le tray fait après un sondage. Il n'ouvre jamais Docker : Docker muet = `.dockerDown`, rien d'autre.
/// Un Desk qui répond est en marche, même si `docker info` n'a pas répondu.
/// `start.sh` (`up --build`) peut recréer le conteneur et couper des reviews : il faut deux sondages muets de suite,
/// même au lancement du tray (un Desk lent à répondre n'est pas un Desk arrêté), et 30 s après le retour de Docker.
public func nextStartStep(dockerUp: Bool, deskHealthy: Bool, stoppedByUser: Bool, consecutiveMisses: Int,
                          secondsSinceDockerBack: Double?) -> StartStep {
    if deskHealthy { return .done }
    if !dockerUp { return .dockerDown }
    if stoppedByUser { return .done }
    if let since = secondsSinceDockerBack, since < dockerBackGrace { return .wait }
    if consecutiveMisses < 2 { return .wait }
    return .runStartScript
}

/// Cause d'un échec de `start.sh --no-prompt` : sa dernière ligne `✗ …` (sans le ✗), sinon le code de sortie.
public func startFailureMessage(output: String, code: Int32) -> String {
    let lines = output.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }
    guard let last = lines.last(where: { $0.hasPrefix("✗") }) else { return "start.sh a échoué (code \(code))" }
    return last.dropFirst().trimmingCharacters(in: .whitespaces)
}
