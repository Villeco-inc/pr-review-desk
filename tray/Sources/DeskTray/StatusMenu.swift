import AppKit
import DeskCore

/// Traduit les `MenuItem` de DeskCore en `NSMenu`. Un clic rend la `MenuAction` de l'entrée.
@MainActor
final class StatusMenu: NSObject, NSMenuDelegate {
    let menu = NSMenu()
    var onAction: (MenuAction) -> Void = { _ in }
    var onOpenChange: (Bool) -> Void = { _ in }
    /// Seul moment où le menu peut changer de structure avant de s'afficher (pas dans `menuWillOpen`).
    var onNeedsUpdate: () -> Void = {}
    private var actions: [MenuAction] = []

    override init() {
        super.init()
        menu.autoenablesItems = false
        menu.delegate = self
    }

    func show(_ items: [MenuItem]) {
        menu.removeAllItems()
        actions = []
        for item in items { menu.addItem(nsItem(item)) }
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        // Sans `.title`, AppKit ne cherche qu'un raccourci clavier : le menu ne s'ouvre pas.
        if menu.propertiesToUpdate.contains(.propertyItemTitle) { onNeedsUpdate() }
    }
    func menuWillOpen(_ menu: NSMenu) { onOpenChange(true) }
    func menuDidClose(_ menu: NSMenu) { onOpenChange(false) }

    @objc private func clicked(_ sender: NSMenuItem) {
        guard actions.indices.contains(sender.tag) else { return }
        onAction(actions[sender.tag])
    }

    private func nsItem(_ item: MenuItem) -> NSMenuItem {
        switch item {
        case let .header(title):
            return NSMenuItem.sectionHeader(title: title)
        case let .info(title, detail):
            let ns = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            if let detail {
                let text = NSMutableAttributedString(string: title, attributes: [.font: NSFont.menuFont(ofSize: 0)])
                text.append(NSAttributedString(string: "  \(detail)", attributes: [
                    .font: NSFont.menuFont(ofSize: 0), .foregroundColor: NSColor.secondaryLabelColor,
                ]))
                ns.attributedTitle = text
            }
            ns.isEnabled = false
            return ns
        case let .action(action, title, bold, enabled):
            let ns = actionItem(action, title: title)
            if bold { ns.attributedTitle = NSAttributedString(string: title, attributes: [.font: NSFont.boldSystemFont(ofSize: NSFont.systemFontSize)]) }
            ns.isEnabled = enabled
            return ns
        case let .toggle(action, title, on):
            let ns = actionItem(action, title: title)
            ns.state = on ? .on : .off
            return ns
        case .separator:
            return .separator()
        }
    }

    private func actionItem(_ action: MenuAction, title: String) -> NSMenuItem {
        let ns = NSMenuItem(title: title, action: #selector(clicked(_:)), keyEquivalent: keyEquivalent(action) ?? "")
        ns.target = self
        ns.tag = actions.count
        actions.append(action)
        return ns
    }
}
