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

// The only package that imports a telemetry SDK. Features depend on
// AedstAnalytics' protocols; App/Shared composes this implementation.
//
// Versions: latest stable, verified 2026-10-07 via the GitHub releases API
// (`/repos/<owner>/<repo>/releases/latest`):
//   sentry-cocoa 9.35.0  (its own OS floor is below the app's iOS 18 / macOS 15)
//   posthog-ios  3.98.0  (its own OS floor is below the app's iOS 18 / macOS 15)
let package = Package(
    name: "AedstTelemetry",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "AedstTelemetry", targets: ["AedstTelemetry"]),
    ],
    dependencies: [
        .package(path: "../AedstCore"),
        .package(path: "../AedstAnalytics"),
        .package(url: "https://github.com/getsentry/sentry-cocoa", from: "9.35.0"),
        .package(url: "https://github.com/PostHog/posthog-ios", from: "3.98.0"),
    ],
    targets: [
        .target(
            name: "AedstTelemetry",
            dependencies: [
                "AedstCore",
                "AedstAnalytics",
                .product(name: "Sentry", package: "sentry-cocoa"),
                .product(name: "PostHog", package: "posthog-ios"),
            ],
            swiftSettings: swiftSettings
        ),
        .testTarget(
            name: "AedstTelemetryTests",
            dependencies: ["AedstTelemetry", "AedstCore", "AedstAnalytics"],
            swiftSettings: swiftSettings
        ),
    ],
    swiftLanguageModes: [.v6]
)
