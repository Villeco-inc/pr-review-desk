import Foundation

public let defaultHostPort = 37703

/// Lit `HOST_PORT` dans le contenu d'un fichier `.env` : la dernière ligne gagne,
/// les guillemets simples ou doubles et un commentaire ` # …` sont acceptés.
/// Valeur absente, illisible ou hors de 1...65535 : 37703.
public func readHostPort(envFile: String?) -> Int {
    guard let envFile else { return defaultHostPort }
    var raw: String?
    for line in envFile.split(whereSeparator: \.isNewline) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("HOST_PORT=") else { continue }
        raw = String(trimmed.dropFirst("HOST_PORT=".count))
    }
    guard let raw, let value = unquotedValue(raw), let port = Int(value), (1...65535).contains(port) else {
        return defaultHostPort
    }
    return port
}

private func unquotedValue(_ raw: String) -> String? {
    let value = raw.trimmingCharacters(in: .whitespaces)
    if let quote = value.first, quote == "\"" || quote == "'" {
        let rest = value.dropFirst()
        guard let end = rest.firstIndex(of: quote) else { return nil }
        return String(rest[..<end])
    }
    if let comment = value.range(of: #"\s#"#, options: .regularExpression) {
        return String(value[..<comment.lowerBound]).trimmingCharacters(in: .whitespaces)
    }
    return value
}
