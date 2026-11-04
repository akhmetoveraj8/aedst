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
    name: "AedstNavigation",
    // Kept iOS/macOS-only: only these have app targets today. Widen this list deliberately, not by default.
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "AedstNavigation", targets: ["AedstNavigation"]),
    ],
    targets: [
        .target(
            name: "AedstNavigation",
            swiftSettings: swiftSettings
        ),
        .testTarget(
            name: "AedstNavigationTests",
            dependencies: ["AedstNavigation"],
            swiftSettings: swiftSettings
        ),
    ],
    swiftLanguageModes: [.v6]
)
