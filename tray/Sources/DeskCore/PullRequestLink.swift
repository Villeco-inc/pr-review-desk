import Foundation

public struct PullRequestLink: Hashable, Sendable {
    public let owner: String
    public let repo: String
    public let number: Int

    public init(owner: String, repo: String, number: Int) {
        self.owner = owner
        self.repo = repo
        self.number = number
    }

    /// `owner/repo#n`
    public var slug: String { "\(owner)/\(repo)#\(number)" }
}

private let pullRequestPattern = try! NSRegularExpression(
    pattern: #"^https?://(www\.)?github\.com/([^/\s]+)/([^/\s]+)/pull/(\d+)([/?#]\S*)?$"#
)

/// Reconnaît un lien de PR GitHub (texte coupé de ses espaces) ; `nil` sinon.
public func parsePullRequestLink(_ text: String) -> PullRequestLink? {
    let s = text.trimmingCharacters(in: .whitespacesAndNewlines)
    let range = NSRange(s.startIndex..., in: s)
    guard let m = pullRequestPattern.firstMatch(in: s, range: range),
          let owner = Range(m.range(at: 2), in: s),
          let repo = Range(m.range(at: 3), in: s),
          let number = Range(m.range(at: 4), in: s),
          let n = Int(s[number]) else { return nil }
    return PullRequestLink(owner: String(s[owner]), repo: String(s[repo]), number: n)
}

/// Ce que le Desk sait d'une PR copiée : `GET /api/prs/…` (titre et commit courant lus sur GitHub, état et commit
/// de la dernière review).
public struct CopiedPullRequest: Equatable, Sendable {
    public let title: String
    public let reviewStatus: String?
    public let headSha: String?
    public let reviewedHeadSha: String?

    public init(title: String, reviewStatus: String?, headSha: String?, reviewedHeadSha: String?) {
        self.title = title
        self.reviewStatus = reviewStatus
        self.headSha = headSha
        self.reviewedHeadSha = reviewedHeadSha
    }
}

/// Résultat de la vérification d'un lien copié : `nil` quand le Desk n'a pas répondu (`followedRepos` absent),
/// `.inaccessible` quand il n'a pas pu lire la PR, `.ready` sinon.
public func clipboardCheckResult(_ link: PullRequestLink, pullRequest: CopiedPullRequest?, followedRepos: [String]?) -> ClipboardState? {
    guard let followedRepos else { return nil }
    guard let pullRequest else { return .inaccessible(link) }
    let repo = "\(link.owner)/\(link.repo)".lowercased()
    return .ready(link, title: pullRequest.title, review: reviewState(pullRequest),
                  followed: followedRepos.contains { $0.lowercased() == repo })
}

/// Sans l'un des deux commits, rien ne se compare : la PR se présente comme jamais revue, et le Desk répond
/// « aucun nouveau commit » au clic si elle l'était.
private func reviewState(_ pr: CopiedPullRequest) -> PullRequestReview {
    if ["queued", "running"].contains(pr.reviewStatus ?? "") { return .running }
    guard let reviewed = pr.reviewedHeadSha, let head = pr.headSha else { return .none }
    return reviewed == head ? .upToDate : .outdated
}
