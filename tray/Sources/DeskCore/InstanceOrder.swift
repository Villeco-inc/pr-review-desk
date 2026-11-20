import Foundation

/// Le tray le plus ancien cède la place. Plus tôt lancé = plus ancien ; à égalité ou sans date, le plus petit pid.
/// Ordre strict : deux trays ne peuvent jamais se terminer l'un l'autre.
public func isOlderInstance(launched: Date?, pid: Int32, than mine: Date?, pid myPid: Int32) -> Bool {
    if let launched, let mine, launched != mine { return launched < mine }
    return pid < myPid
}
