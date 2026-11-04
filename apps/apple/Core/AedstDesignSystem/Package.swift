// swift-tools-version: 6.0
import PackageDescription

// Swift 6 language mode with complete strict concurrency for every target (`swiftLanguageModes` below; Config/Base.xcconfig
// sets the same for the app targets). The two upcoming features were verified to exist in Swift 6.2 and 6.3
// (swiftlang/swift include/swift/Basic/Features.def, branches release/6.2 and release/6.3): SE-0461 makes `nonisolated async`
// functions run on the caller's actor, SE-0470 infers actor isolation for protocol conformances. Xcode 26.6 (CI) has both.
let swiftSettings: [SwiftSetting] = [
    .enableUpcomingFeature("NonisolatedNonsendingByDefault"),
    .enableUpcomingFeature("InferIsolatedConformances"),
]

let package = Package(
    name: "AedstDesignSystem",
    defaultLocalization: "en",
    // watchOS/tvOS/visionOS are scaffolded minimums for future app targets:
    // only App_iOS and App_macOS exist in Project.swift today, so these three
    // platforms build the package but have no real UI/entry point yet.
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
        .watchOS(.v11),
        .tvOS(.v18),
        .visionOS(.v2),
    ],
    products: [
        .library(name: "AedstDesignSystem", targets: ["AedstDesignSystem"]),
    ],
    dependencies: [
        // Only for `AedstError` in `AedstErrorPresenter` (Foundation-only package, no UI).
        .package(path: "../AedstCore"),
        // Test-only (Point-Free). Latest stable verified 2026-10-28: 1.19.7.
        .package(url: "https://github.com/pointfreeco/swift-snapshot-testing", from: "1.19.7"),
    ],
    targets: [
        .target(
            name: "AedstDesignSystem",
            dependencies: ["AedstCore"],
            resources: [.process("Resources")],
            swiftSettings: swiftSettings
        ),
        .testTarget(
            name: "AedstDesignSystemTests",
            dependencies: [
                "AedstDesignSystem",
                .product(name: "SnapshotTesting", package: "swift-snapshot-testing"),
            ],
            // Snapshots/README.md is documentation; Snapshots/__Snapshots__ holds the recorded
            // reference PNGs read by SnapshotTesting from disk (not SwiftPM resources).
            exclude: ["Snapshots/README.md", "Snapshots/__Snapshots__"],
            swiftSettings: swiftSettings
        ),
    ],
    swiftLanguageModes: [.v6]
)
