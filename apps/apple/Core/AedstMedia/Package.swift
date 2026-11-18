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

// Media toolkit: remote image loading/caching via Nuke (owner decision: SwiftUI
// AsyncImage has no real disk cache or prefetching); platform APIs for ImageIO
// compression, AVKit playback, QuickLookThumbnailing / AVAssetImageGenerator thumbnails,
// AVAssetExportSession video compression, a PHPicker wrapper and a background
// URLSession uploader. Server-contract logic (CreateUpload → PUT → CompleteUpload)
// lives in Features/Media; this package knows nothing about the API.
let package = Package(
    name: "AedstMedia",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "AedstMedia", targets: ["AedstMedia"]),
    ],
    dependencies: [
        .package(path: "../AedstCore"),
        .package(path: "../AedstDesignSystem"),
        .package(url: "https://github.com/kean/Nuke", from: "13.2.3"),
    ],
    targets: [
        .target(
            name: "AedstMedia",
            dependencies: [
                "AedstCore",
                "AedstDesignSystem",
                .product(name: "Nuke", package: "Nuke"),
                .product(name: "NukeUI", package: "Nuke"),
            ],
            swiftSettings: swiftSettings
        ),
        .testTarget(
            name: "AedstMediaTests",
            dependencies: [
                "AedstMedia",
                .product(name: "Nuke", package: "Nuke"),
            ],
            swiftSettings: swiftSettings
        ),
    ],
    swiftLanguageModes: [.v6]
)
