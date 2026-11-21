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

// One business logic, two UI builds (decisions/apple.md): `MediaDomain`, `MediaData` and `MediaPresentation` are shared;
// `MediaUIiOS` is linked by App_iOS only and `MediaUIMac` by App_macOS only. A UI target's dependencies carry a platform
// condition and every file in it is wrapped in one `#if os(...)` guard, so the other platform compiles it to nothing
// (`swift build` on a Mac host still builds the whole package). scripts/check-feature-boundaries.sh enforces the rest.
let iOSOnly: TargetDependencyCondition? = .when(platforms: [.iOS])
let macOnly: TargetDependencyCondition? = .when(platforms: [.macOS])

let package = Package(
    name: "Media",
    defaultLocalization: "en",
    // Kept iOS/macOS-only: those are the only app targets; widen deliberately.
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "MediaDomain", targets: ["MediaDomain"]),
        .library(name: "MediaData", targets: ["MediaData"]),
        .library(name: "MediaPresentation", targets: ["MediaPresentation"]),
        .library(name: "MediaUIiOS", targets: ["MediaUIiOS"]),
        .library(name: "MediaUIMac", targets: ["MediaUIMac"]),
    ],
    dependencies: [
        .package(path: "../../Core/AedstCore"),
        .package(path: "../../Core/AedstNetwork"),
        .package(path: "../../Core/AedstDesignSystem"),
        .package(path: "../../Core/AedstNavigation"),
        .package(path: "../../Core/AedstAnalytics"),
        .package(path: "../../Core/AedstTesting"),
        .package(path: "../../Core/AedstMedia"),
    ],
    targets: [
        // Models, repository protocols, use cases. No UI, network or persistence import.
        .target(
            name: "MediaDomain",
            dependencies: ["AedstCore", "AedstMedia"],
            swiftSettings: swiftSettings
        ),
        // Repository implementations.
        .target(
            name: "MediaData",
            dependencies: ["MediaDomain", "AedstCore", "AedstNetwork"],
            swiftSettings: swiftSettings
        ),
        // Platform-neutral `@Observable` view models and the String Catalog both UI builds read.
        .target(
            name: "MediaPresentation",
            dependencies: ["MediaDomain", "AedstCore", "AedstAnalytics", "AedstMedia"],
            resources: [.process("Resources")],
            swiftSettings: swiftSettings
        ),
        // SwiftUI views for iPhone and iPad.
        .target(
            name: "MediaUIiOS",
            dependencies: [
                .target(name: "MediaDomain", condition: iOSOnly),
                .target(name: "MediaPresentation", condition: iOSOnly),
                .product(name: "AedstCore", package: "AedstCore", condition: iOSOnly),
                .product(name: "AedstDesignSystem", package: "AedstDesignSystem", condition: iOSOnly),
                .product(name: "AedstNavigation", package: "AedstNavigation", condition: iOSOnly),
                .product(name: "AedstMedia", package: "AedstMedia", condition: iOSOnly),
            ],
            swiftSettings: swiftSettings
        ),
        // SwiftUI views for the Mac.
        .target(
            name: "MediaUIMac",
            dependencies: [
                .target(name: "MediaDomain", condition: macOnly),
                .target(name: "MediaPresentation", condition: macOnly),
                .product(name: "AedstCore", package: "AedstCore", condition: macOnly),
                .product(name: "AedstDesignSystem", package: "AedstDesignSystem", condition: macOnly),
                .product(name: "AedstNavigation", package: "AedstNavigation", condition: macOnly),
                .product(name: "AedstMedia", package: "AedstMedia", condition: macOnly),
            ],
            swiftSettings: swiftSettings
        ),
        // Logic tests (domain, data, view models); they run on the Mac host and import no UI target.
        .testTarget(
            name: "MediaTests",
            dependencies: ["MediaDomain", "MediaData", "MediaPresentation", "AedstCore", "AedstAnalytics", "AedstMedia", "AedstTesting"],
            swiftSettings: swiftSettings
        ),
    ],
    swiftLanguageModes: [.v6]
)
