import Foundation
import Testing
@testable import DeskCore

private let t0 = Date(timeIntervalSince1970: 1_000)
private let t1 = Date(timeIntervalSince1970: 1_001)

@Test func earlierLaunchIsOlderWhateverThePid() {
    #expect(isOlderInstance(launched: t0, pid: 900, than: t1, pid: 100))
    #expect(!isOlderInstance(launched: t1, pid: 100, than: t0, pid: 900))
}

@Test func sameInstantOrUnknownDateLowerPidIsOlder() {
    #expect(isOlderInstance(launched: t0, pid: 100, than: t0, pid: 200))
    #expect(!isOlderInstance(launched: t0, pid: 200, than: t0, pid: 100))
    #expect(isOlderInstance(launched: nil, pid: 100, than: t1, pid: 200))
    #expect(!isOlderInstance(launched: t0, pid: 200, than: nil, pid: 100))
    #expect(!isOlderInstance(launched: nil, pid: 200, than: nil, pid: 100))
}

@Test func anInstanceIsNotOlderThanItself() {
    #expect(!isOlderInstance(launched: t0, pid: 100, than: t0, pid: 100))
}
