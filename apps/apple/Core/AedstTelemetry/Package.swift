// swift-tools-version: 6.0
import PackageDescription

// The only package that imports a telemetry SDK. Features depend on
// AedstAnalytics' protocols; App/Shared composes this implementation.
//
// Versions: latest stable, verified 2026-10-07 via the GitHub releases API
// (`/repos/<owner>/<repo>/releases/latest`):
//   sentry-cocoa 9.31.0  (its own OS floor is below the app's iOS 18 / macOS 15)
//   posthog-ios  3.92.6  (its own OS floor is below the app's iOS 18 / macOS 15)
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
        .package(url: "https://github.com/getsentry/sentry-cocoa", from: "9.31.0"),
        .package(url: "https://github.com/PostHog/posthog-ios", from: "3.92.6"),
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
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .testTarget(
            name: "AedstTelemetryTests",
            dependencies: ["AedstTelemetry", "AedstCore", "AedstAnalytics"],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
    ]
)
