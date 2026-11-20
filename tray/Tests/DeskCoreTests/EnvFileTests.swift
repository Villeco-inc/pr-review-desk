import Testing
@testable import DeskCore

@Test func portDefaults() { #expect(readHostPort(envFile: nil) == 37703) }
@Test func portQuotedAndCommented() { #expect(readHostPort(envFile: "A=1\nHOST_PORT=\"4100\" # perso\n") == 4100) }
@Test func portLastWins() { #expect(readHostPort(envFile: "HOST_PORT=4100\nHOST_PORT=4200\n") == 4200) }
@Test func portGarbage() { #expect(readHostPort(envFile: "HOST_PORT=abc\n") == 37703) }
@Test func portOutOfRange() { #expect(readHostPort(envFile: "HOST_PORT=70000\n") == 37703) }
