import Foundation

/// Lance un outil externe sans jamais bloquer le fil principal.
/// stdout et stderr partagent UN tube : l'ordre d'écriture est conservé.
enum Shell {
    static let searchDirs = [
        "/opt/homebrew/bin", "/usr/local/bin", "~/.local/bin", "/usr/bin",
        "/Applications/Docker.app/Contents/Resources/bin",
        "/Applications/OrbStack.app/Contents/MacOS/xbin",
    ]

    /// Code de retour quand le délai est dépassé (convention de timeout(1)).
    static let timeoutCode: Int32 = 124
    /// Code de retour quand l'outil est introuvable ou ne démarre pas.
    static let launchFailureCode: Int32 = 127

    /// Un `PATH` fourni dans `env` est remplacé par le PATH résolu (liste du brief puis PATH hérité).
    static func run(_ tool: String, _ args: [String], cwd: String, env: [String: String] = [:],
                    timeout: TimeInterval) async -> (code: Int32, out: String) {
        let (executable, environment) = prepare(tool, cwd: cwd, env: env)
        guard let executable else { return (launchFailureCode, "outil introuvable : \(tool)") }
        let job = Job()
        return await withCheckedContinuation { cont in
            job.start(executable: executable, args: args, cwd: cwd, env: environment, timeout: timeout) { cont.resume(returning: $0) }
        }
    }

    /// Comme `run`, mais l'outil démarre dans sa propre session (`POSIX_SPAWN_SETSID`) : quand launchd tue le tray
    /// et son groupe de processus (`launchctl kickstart -k`), l'outil, lui, continue.
    static func runInOwnSession(_ tool: String, _ args: [String], cwd: String, timeout: TimeInterval) async -> (code: Int32, out: String) {
        let (executable, environment) = prepare(tool, cwd: cwd, env: [:])
        guard let executable else { return (launchFailureCode, "outil introuvable : \(tool)") }
        return await withCheckedContinuation { cont in
            DispatchQueue.global().async {
                cont.resume(returning: SessionJob.run(executable: executable, args: args, cwd: cwd, env: environment, timeout: timeout))
            }
        }
    }

    private static func prepare(_ tool: String, cwd: String, env: [String: String]) -> (executable: String?, env: [String: String]) {
        let dirs = searchDirs.map { ($0 as NSString).expandingTildeInPath }
        let inherited = ProcessInfo.processInfo.environment["PATH"] ?? ""
        var environment = ProcessInfo.processInfo.environment
        for (k, v) in env { environment[k] = v }
        environment["PATH"] = (dirs + (inherited.isEmpty ? [] : [inherited])).joined(separator: ":")
        return (resolve(tool, cwd: cwd, dirs: dirs + inherited.split(separator: ":").map(String.init)), environment)
    }

    private static func resolve(_ tool: String, cwd: String, dirs: [String]) -> String? {
        let fm = FileManager.default
        if tool.contains("/") {
            let path = tool.hasPrefix("/") ? tool : (cwd as NSString).appendingPathComponent(tool)
            return fm.isExecutableFile(atPath: path) ? path : nil
        }
        for dir in dirs where !dir.isEmpty {
            let path = (dir as NSString).appendingPathComponent(tool)
            if fm.isExecutableFile(atPath: path) { return path }
        }
        return nil
    }
}

/// Un processus en cours. Les accès à l'état passent par `lock` ; le tube est lu en continu
/// pendant l'attente, donc un tampon plein ne peut pas bloquer l'enfant.
private final class Job: @unchecked Sendable {
    private let lock = NSLock()
    private let process = Process()
    private var data = Data()
    private var exitCode: Int32?
    private var eof = false
    private var timedOut = false
    private var done = false
    private var reader: FileHandle?
    private var completion: (((code: Int32, out: String)) -> Void)?

    func start(executable: String, args: [String], cwd: String, env: [String: String], timeout: TimeInterval,
               completion: @escaping ((code: Int32, out: String)) -> Void) {
        self.completion = completion
        let pipe = Pipe()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = args
        process.currentDirectoryURL = URL(fileURLWithPath: cwd)
        process.environment = env
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = pipe
        process.standardError = pipe

        let reader = pipe.fileHandleForReading
        self.reader = reader
        reader.readabilityHandler = { [self] h in
            let chunk = h.availableData
            lock.lock()
            if chunk.isEmpty { eof = true } else { data.append(chunk) }
            lock.unlock()
            if chunk.isEmpty { h.readabilityHandler = nil; finishIfReady() }
        }
        process.terminationHandler = { [self] p in
            lock.lock(); exitCode = p.terminationStatus; lock.unlock()
            finishIfReady()
            // Un petit-enfant peut garder le tube ouvert : on ne l'attend pas indéfiniment.
            DispatchQueue.global().asyncAfter(deadline: .now() + 1) { [self] in finish(force: true) }
        }
        do {
            try process.run()
        } catch {
            reader.readabilityHandler = nil
            lock.lock(); data = Data("démarrage impossible : \(error.localizedDescription)".utf8); exitCode = Shell.launchFailureCode; eof = true; lock.unlock()
            finishIfReady()
            return
        }
        try? pipe.fileHandleForWriting.close()

        DispatchQueue.global().asyncAfter(deadline: .now() + timeout) { [self] in
            guard process.isRunning else { return }
            lock.lock(); timedOut = true; lock.unlock()
            process.terminate()
            DispatchQueue.global().asyncAfter(deadline: .now() + 2) { [self] in
                if process.isRunning { kill(process.processIdentifier, SIGKILL) }
            }
        }
    }

    private func finishIfReady() { finish(force: false) }

    private func finish(force: Bool) {
        lock.lock()
        guard !done, let code = exitCode, eof || force else { lock.unlock(); return }
        done = true
        let out = String(decoding: data, as: UTF8.self)
        let result = (code: timedOut ? Shell.timeoutCode : code, out: out)
        reader?.readabilityHandler = nil
        try? reader?.close()
        reader = nil
        let cb = completion
        completion = nil
        lock.unlock()
        cb?(result)
    }
}

/// `posix_spawn` dans une nouvelle session, sortie lue sur un seul tube. Bloquant : appelé hors du fil principal.
private enum SessionJob {
    static func run(executable: String, args: [String], cwd: String, env: [String: String],
                    timeout: TimeInterval) -> (code: Int32, out: String) {
        var fds: [Int32] = [0, 0]
        guard pipe(&fds) == 0 else { return (Shell.launchFailureCode, "tube impossible : \(String(cString: strerror(errno)))") }
        let (readEnd, writeEnd) = (fds[0], fds[1])

        var actions: posix_spawn_file_actions_t?
        posix_spawn_file_actions_init(&actions)
        defer { posix_spawn_file_actions_destroy(&actions) }
        posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0)
        posix_spawn_file_actions_adddup2(&actions, writeEnd, 1)
        posix_spawn_file_actions_adddup2(&actions, writeEnd, 2)
        posix_spawn_file_actions_addchdir_np(&actions, cwd)

        var attr: posix_spawnattr_t?
        posix_spawnattr_init(&attr)
        defer { posix_spawnattr_destroy(&attr) }
        // CLOEXEC_DEFAULT : l'enfant ne reçoit que 0, 1 et 2, aucun autre descripteur du tray.
        posix_spawnattr_setflags(&attr, Int16(POSIX_SPAWN_SETSID | POSIX_SPAWN_CLOEXEC_DEFAULT))

        let argv = ([executable] + args).map { strdup($0) } + [nil]
        let envp = env.map { strdup("\($0.key)=\($0.value)") } + [nil]
        defer { for p in argv + envp { free(p) } }

        var pid: pid_t = 0
        let rc = posix_spawn(&pid, executable, &actions, &attr, argv, envp)
        close(writeEnd)
        guard rc == 0 else {
            close(readEnd)
            return (Shell.launchFailureCode, "démarrage impossible : \(String(cString: strerror(rc)))")
        }
        _ = fcntl(readEnd, F_SETFL, O_NONBLOCK)
        defer { close(readEnd) }

        var out = Data()
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        var eof = false
        var status: Int32 = 0
        var exitedAt: Date?
        var killedAt: Date?
        let deadline = Date().addingTimeInterval(timeout)
        // Un petit-enfant peut garder le tube ouvert : on ne l'attend pas plus d'une seconde après la sortie.
        while !(exitedAt != nil && (eof || Date().timeIntervalSince(exitedAt!) > 1)) {
            if eof {
                usleep(100_000)
            } else {
                var pfd = pollfd(fd: readEnd, events: Int16(POLLIN), revents: 0)
                if poll(&pfd, 1, 200) > 0 {
                    let n = read(readEnd, &buffer, buffer.count)
                    if n > 0 {
                        out.append(contentsOf: buffer[0..<n])
                    } else if n == 0 || (errno != EAGAIN && errno != EINTR) {
                        eof = true
                    }
                }
            }
            if exitedAt == nil {
                let w = waitpid(pid, &status, WNOHANG)
                // -1 hors EINTR (ECHILD) : l'enfant n'est plus attendable, on le tient pour sorti.
                if w == pid || (w == -1 && errno != EINTR) { exitedAt = Date() }
            }
            if exitedAt == nil {
                if killedAt == nil, Date() > deadline {
                    killedAt = Date()
                    kill(-pid, SIGTERM)
                } else if let killedAt, Date().timeIntervalSince(killedAt) > 2 {
                    kill(-pid, SIGKILL)
                }
            }
        }
        let signal = status & 0x7f
        let code = killedAt != nil ? Shell.timeoutCode : (signal == 0 ? (status >> 8) & 0xff : 128 + signal)
        return (code, String(decoding: out, as: UTF8.self))
    }
}
