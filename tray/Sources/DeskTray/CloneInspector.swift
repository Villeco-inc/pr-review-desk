import DeskCore
import Foundation

struct CloneInspector: Sendable {
    let path: String

    init(path: String) { self.path = path }

    /// `runningCommit` est transmis par l'appelant (qui le compare via `updateState`) ; il ne fait
    /// pas partie de `CloneFacts`, donc il est inutilisé ici.
    func facts(runningCommit: String?) async -> CloneFacts {
        _ = runningCommit
        let fetchEnv = ["GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes"]
        let fetch = await Shell.run("git", ["fetch", "origin", "main"], cwd: path, env: fetchEnv, timeout: 30)
        var fetchError: String?
        if fetch.code == Shell.timeoutCode {
            fetchError = "délai dépassé"
        } else if fetch.code != 0 {
            fetchError = errorLine(fetch.out) ?? "échec de git fetch"
        }

        let gitDir = await git(["rev-parse", "--git-dir"])
        let commonDir = await git(["rev-parse", "--git-common-dir"])
        let isMain = absolute(gitDir) == absolute(commonDir) && gitDir != nil

        let abbrev = await git(["rev-parse", "--abbrev-ref", "HEAD"])
        let branch = (abbrev == nil || abbrev == "HEAD") ? nil : abbrev
        let clean = (await git(["status", "--porcelain"], trim: false)) == ""
        let head = await git(["rev-parse", "--short", "HEAD"]) ?? ""
        let originMain = await git(["rev-parse", "--short", "origin/main"])
        var behind = 0, ahead = 0
        if originMain != nil, let counts = await git(["rev-list", "--left-right", "--count", "HEAD...origin/main"]) {
            let parts = counts.split(whereSeparator: { $0 == "\t" || $0 == " " }).compactMap { Int($0) }
            if parts.count == 2 { ahead = parts[0]; behind = parts[1] }
        }
        let remote = await git(["remote", "get-url", "origin"]) ?? ""
        return CloneFacts(isMainClone: isMain, branch: branch, isClean: clean, head: head, originMain: originMain,
                          behind: behind, ahead: ahead, fetchError: fetchError, isReferenceRemote: isReferenceRemote(remote))
    }

    /// Sortie de git en cas de succès (nil sinon).
    private func git(_ args: [String], trim: Bool = true) async -> String? {
        let r = await Shell.run("git", args, cwd: path, env: ["GIT_OPTIONAL_LOCKS": "0"], timeout: 15)
        guard r.code == 0 else { return nil }
        return trim ? r.out.trimmingCharacters(in: .whitespacesAndNewlines) : r.out
    }

    private func absolute(_ dir: String?) -> String? {
        guard let dir else { return nil }
        let full = dir.hasPrefix("/") ? dir : (path as NSString).appendingPathComponent(dir)
        return URL(fileURLWithPath: full).resolvingSymlinksInPath().standardized.path
    }

    /// Dernière ligne `fatal:` ou `error:` (préfixe retiré), sinon la dernière ligne non vide.
    private func errorLine(_ s: String) -> String? {
        let lines = s.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        for l in lines.reversed() {
            for prefix in ["fatal:", "error:"] where l.hasPrefix(prefix) {
                return String(l.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
            }
        }
        return lines.last
    }
}
