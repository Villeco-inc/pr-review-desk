import AppKit
import DeskCore

/// Le dessin de `public/favicon.svg` sans son carré, tracé dans 18×18 pt.
enum Icon {
    private static let size = NSSize(width: 18, height: 18)
    private static let blue = NSColor(srgbRed: 0x03 / 255, green: 0x85 / 255, blue: 0xCA / 255, alpha: 1)
    private static let red = NSColor(srgbRed: 0xE0 / 255, green: 0x44 / 255, blue: 0x3E / 255, alpha: 1)

    static func image(_ state: IconState) -> NSImage {
        let image: NSImage
        switch state {
        case .normal:
            image = draw(.black, alpha: 1, badge: false)
        case .busy:
            image = draw(.black, alpha: 0.4, badge: false, refreshing: true)
        case .updateAvailable:
            image = draw(.labelColor, alpha: 1, badge: true)
        case .problem:
            image = draw(red, alpha: 1, badge: false)
        }
        image.isTemplate = state == .normal || state == .busy
        return image
    }

    /// Le SVG fait 32 unités ; son dessin tient dans le carré 6…26, ramené à 18 pt (échelle 0,9).
    private static func draw(_ color: NSColor, alpha: CGFloat, badge: Bool, refreshing: Bool = false) -> NSImage {
        NSImage(size: size, flipped: true) { _ in
            func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: (x - 6) * 0.9, y: (y - 6) * 0.9) }
            let stroke = NSBezierPath()
            stroke.lineWidth = 2.5 * 0.9
            stroke.lineCapStyle = .round
            stroke.lineJoinStyle = .round
            stroke.move(to: p(10, 8)); stroke.line(to: p(10, 24))
            stroke.move(to: p(10, 8)); stroke.line(to: p(16, 12)); stroke.line(to: p(10, 16))
            stroke.move(to: p(22, 14)); stroke.line(to: p(22, 24))
            let r = 1.5 * 0.9
            let center = p(22, 11)
            let dot = NSBezierPath(ovalIn: NSRect(x: center.x - r, y: center.y - r, width: 2 * r, height: 2 * r))

            color.withAlphaComponent(alpha).set()
            stroke.stroke()
            dot.fill()
            if badge {
                blue.setFill()
                NSBezierPath(ovalIn: NSRect(x: 12, y: 0, width: 6, height: 6)).fill()
            }
            if refreshing { drawRefreshBadge() }
            return true
        }
    }

    /// Flèches circulaires en bas à droite, sur un disque évidé pour rester lisibles par-dessus le dessin atténué.
    private static func drawRefreshBadge() {
        let disc = NSRect(x: 8, y: 8, width: 10, height: 10)
        NSGraphicsContext.current?.compositingOperation = .clear
        NSBezierPath(ovalIn: disc).fill()
        NSGraphicsContext.current?.compositingOperation = .sourceOver
        let config = NSImage.SymbolConfiguration(pointSize: 8, weight: .bold)
        guard let arrows = NSImage(systemSymbolName: "arrow.triangle.2.circlepath", accessibilityDescription: nil)?
            .withSymbolConfiguration(config) else { return }
        let fit = min(disc.width / arrows.size.width, disc.height / arrows.size.height)
        let size = NSSize(width: arrows.size.width * fit, height: arrows.size.height * fit)
        let rect = NSRect(x: disc.midX - size.width / 2, y: disc.midY - size.height / 2, width: size.width, height: size.height)
        arrows.draw(in: rect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
    }
}
