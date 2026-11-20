import Foundation
@preconcurrency import UserNotifications

/// Notifications macOS. Hors d'un bundle (`swift run`), `UNUserNotificationCenter` plante : le texte passe alors,
/// comme quand l'autorisation est refusée, par `fallback` (une ligne du menu).
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    var fallback: (String) -> Void = { _ in }
    private var asked = false
    private let available = Bundle.main.bundleIdentifier != nil

    override init() {
        super.init()
        if available { UNUserNotificationCenter.current().delegate = self }
    }

    func post(_ text: String) {
        guard available else { return fallback(text) }
        Task {
            let center = UNUserNotificationCenter.current()
            if !asked {
                asked = true
                _ = try? await center.requestAuthorization(options: [.alert, .sound])
            }
            let status = await center.notificationSettings().authorizationStatus
            guard status == .authorized || status == .provisional else { return fallback(text) }
            let content = UNMutableNotificationContent()
            content.title = "PR Review Desk"
            content.body = text
            do {
                try await center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil))
            } catch {
                fallback(text)
            }
        }
    }

    /// Le menu ouvert rend l'app active : sans ceci, macOS tairait la bannière.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list])
    }
}
