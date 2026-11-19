import Foundation

/// Faits lus dans le clone git ; commits en SHA courts.
public struct CloneFacts: Equatable, Sendable {
    public let isMainClone: Bool
    public let branch: String?
    public let isClean: Bool
    public let head: String
    public let originMain: String?
    public let behind: Int
    public let ahead: Int
    public let fetchError: String?
    public let isReferenceRemote: Bool

    public init(isMainClone: Bool, branch: String?, isClean: Bool, head: String, originMain: String?,
                behind: Int, ahead: Int, fetchError: String?, isReferenceRemote: Bool) {
        self.isMainClone = isMainClone
        self.branch = branch
        self.isClean = isClean
        self.head = head
        self.originMain = originMain
        self.behind = behind
        self.ahead = ahead
        self.fetchError = fetchError
        self.isReferenceRemote = isReferenceRemote
    }
}

public enum UpdateBlock: Equatable, Sendable {
    case notMainClone, notOnMain(String?), dirty, diverged
}

/// Pourquoi on ne peut pas mettre à jour ; `nil` si rien ne l'empêche.
/// `ahead > 0` (seul ou avec `behind`) = `.diverged` : on ne pousse jamais pour l'utilisateur.
public func updateBlockReason(_ f: CloneFacts) -> UpdateBlock? {
    if !f.isMainClone { return .notMainClone }
    if f.branch != "main" { return .notOnMain(f.branch) }
    if !f.isClean { return .dirty }
    if f.ahead > 0 { return .diverged }
    return nil
}

public enum UpdateState: Equatable, Sendable {
    case upToDate, checkPending, available(commits: Int), rebuildNeeded, checkFailed(String), blocked(UpdateBlock)
}

public func updateState(running: String?, facts f: CloneFacts) -> UpdateState {
    if let error = f.fetchError { return .checkFailed(error) }
    if f.behind > 0 {
        if let reason = updateBlockReason(f) { return .blocked(reason) }
        return .available(commits: f.behind)
    }
    if let running, !sameCommit(running, f.head) { return .rebuildNeeded }
    return .upToDate
}

/// Deux SHA courts du même commit peuvent différer de longueur : git allonge l'abréviation quand le dépôt grandit.
func sameCommit(_ a: String, _ b: String) -> Bool {
    !a.isEmpty && !b.isEmpty && (a.hasPrefix(b) || b.hasPrefix(a))
}

/// Base de « Voir les changements… » : la version qui tourne, sinon le commit du clone ; `nil` si aucune n'est connue.
public func changesBase(running: String?, head: String?) -> String? {
    if let running, !running.isEmpty { return running }
    if let head, !head.isEmpty { return head }
    return nil
}
