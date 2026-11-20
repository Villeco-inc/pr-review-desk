import Foundation

private let referenceRemotePattern = try! NSRegularExpression(
    pattern: #"^(git@github\.com:|https://github\.com/)Villeco-inc/pr-review-desk(\.git)?$"#,
    options: [.caseInsensitive]
)

/// Vrai si l'URL d'un remote `git` désigne le dépôt de référence (casse ignorée).
public func isReferenceRemote(_ url: String) -> Bool {
    let s = url.trimmingCharacters(in: .whitespacesAndNewlines)
    return referenceRemotePattern.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
}
