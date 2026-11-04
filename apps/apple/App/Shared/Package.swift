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
    name: "AedstAppShared",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "AedstAppShared", targets: ["AedstAppShared"]),
    ],
    dependencies: [
        .package(path: "../../Core/AedstCore"),
        .package(path: "../../Core/AedstNetwork"),
        .package(path: "../../Core/AedstPersistence"),
        .package(path: "../../Core/AedstDesignSystem"),
        .package(path: "../../Core/AedstNavigation"),
        .package(path: "../../Core/AedstAnalytics"),
        .package(path: "../../Core/AedstTesting"),
        .package(path: "../../Core/AedstMedia"),
        .package(path: "../../Core/AedstTelemetry"),
        .package(path: "../../Features/Auth"),
        .package(path: "../../Features/Tasks"),
        .package(path: "../../Features/Search"),
        .package(path: "../../Features/Notifications"),
        .package(path: "../../Features/Media"),
        .package(path: "../../Features/Admin"),
    ],
    targets: [
        .target(
            name: "AedstAppShared",
            dependencies: [
                "AedstCore",
                "AedstNetwork",
                "AedstPersistence",
                "AedstDesignSystem",
                "AedstNavigation",
                "AedstAnalytics",
                "AedstMedia",
                "AedstTelemetry",
                // Foundation-only doubles; the DEBUG-only UI-test launch mode reuses InMemorySecureStore.
                "AedstTesting",
                "Auth",
                "Tasks",
                "Search",
                "Notifications",
                "Media",
                "Admin",
            ],
            resources: [.process("Resources")],
            swiftSettings: swiftSettings
        ),
        .testTarget(
            name: "AedstAppSharedTests",
            dependencies: [
                "AedstAppShared", "AedstCore", "AedstPersistence", "AedstNetwork", "AedstAnalytics",
                "Auth", "Tasks", "Admin", "AedstTesting",
            ],
            swiftSettings: swiftSettings
        ),
    ],
    swiftLanguageModes: [.v6]
)
