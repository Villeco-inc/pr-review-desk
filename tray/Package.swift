// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "DeskTray",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "DeskCore", targets: ["DeskCore"]),
        .executable(name: "DeskTray", targets: ["DeskTray"]),
    ],
    targets: [
        .target(name: "DeskCore"),
        .executableTarget(name: "DeskTray", dependencies: ["DeskCore"]),
        .testTarget(name: "DeskCoreTests", dependencies: ["DeskCore"]),
    ]
)
