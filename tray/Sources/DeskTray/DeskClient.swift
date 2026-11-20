import DeskCore
import Foundation

struct DeskHealthDTO: Decodable, Sendable {
    let mode: String
    let version: String
    let branch: String?
    let port: Int
}

enum PasteOutcome: Equatable, Sendable { case started, running, unchanged }

struct DeskClientError: Error, LocalizedError, Sendable {
    let message: String
    var code: String? = nil
    var errorDescription: String? { message }
}

struct DeskClient: Sendable {
    let port: Int

    init(port: Int) { self.port = port }

    func health() async -> DeskHealthDTO? {
        guard let (data, status) = try? await send("GET", "/api/health", timeout: 3), status == 200 else { return nil }
        return try? JSONDecoder().decode(DeskHealthDTO.self, from: data)
    }

    func followedRepos() async -> [String]? {
        guard let (data, status) = try? await send("GET", "/api/repos", timeout: 10), status == 200 else { return nil }
        return try? JSONDecoder().decode([String].self, from: data)
    }

    func pullRequest(_ l: PullRequestLink) async -> CopiedPullRequest? {
        struct Body: Decodable {
            struct Snapshot: Decodable { let title: String; let headRefOid: String? }
            struct Review: Decodable { let status: String? }
            let snapshot: Snapshot
            let review: Review?
            let reviewedHeadSha: String?
        }
        guard let (data, status) = try? await send("GET", "/api/prs/\(enc(l.owner))/\(enc(l.repo))/\(l.number)", timeout: 10),
              status == 200, let body = try? JSONDecoder().decode(Body.self, from: data) else { return nil }
        return CopiedPullRequest(title: body.snapshot.title, reviewStatus: body.review?.status,
                                 headSha: body.snapshot.headRefOid, reviewedHeadSha: body.reviewedHeadSha)
    }

    func startReview(_ l: PullRequestLink, follow: Bool) async throws -> PasteOutcome {
        struct Req: Encodable { let repo: String; let number: Int; let model: String; let effort: String; let follow: Bool }
        struct Res: Decodable { let started: Bool?; let reason: String?; let error: String?; let code: String? }
        let payload = try JSONEncoder().encode(Req(repo: "\(l.owner)/\(l.repo)", number: l.number, model: "sonnet", effort: "standard", follow: follow))
        let data: Data, status: Int
        do { (data, status) = try await send("POST", "/api/reviews/paste", body: payload, timeout: 10) }
        catch { throw DeskClientError(message: "Desk injoignable : \(error.localizedDescription)") }
        let res = try? JSONDecoder().decode(Res.self, from: data)
        if status == 202 { return .started }
        if status == 200 {
            switch res?.reason {
            case "running": return .running
            case "unchanged": return .unchanged
            default: break
            }
        }
        throw DeskClientError(message: res?.error ?? "Réponse inattendue du Desk (HTTP \(status))", code: res?.code)
    }

    private func enc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? s
    }

    private func send(_ method: String, _ path: String, body: Data? = nil, timeout: TimeInterval) async throws -> (Data, Int) {
        guard let url = URL(string: "http://localhost:\(port)\(path)") else { throw DeskClientError(message: "URL invalide") }
        var req = URLRequest(url: url, timeoutInterval: timeout)
        req.httpMethod = method
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, resp) = try await URLSession.shared.data(for: req)
        return (data, (resp as? HTTPURLResponse)?.statusCode ?? 0)
    }
}
