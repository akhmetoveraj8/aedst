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

// The composition root without views ("One business logic, two UI builds", decisions/apple.md): dependencies, links,
// outbox wiring, the root and preferences view models and the app-shell String Catalog. Root, Home and Preferences
// views live in the app targets (App/iOS/Sources, App/macOS/Sources), one set per platform.
let package = Package(
    name: "AedstAppCore",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "AedstAppCore", targets: ["AedstAppCore"]),
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
            name: "AedstAppCore",
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
                // Shared layers of every feature. The UI targets (<X>UIiOS, <X>UIMac) are linked by the app targets.
                .product(name: "AuthDomain", package: "Auth"),
                .product(name: "AuthData", package: "Auth"),
                .product(name: "AuthPresentation", package: "Auth"),
                .product(name: "TasksDomain", package: "Tasks"),
                .product(name: "TasksData", package: "Tasks"),
                .product(name: "TasksPresentation", package: "Tasks"),
                .product(name: "SearchDomain", package: "Search"),
                .product(name: "SearchData", package: "Search"),
                .product(name: "SearchPresentation", package: "Search"),
                .product(name: "NotificationsDomain", package: "Notifications"),
                .product(name: "NotificationsData", package: "Notifications"),
                .product(name: "NotificationsPresentation", package: "Notifications"),
                .product(name: "MediaDomain", package: "Media"),
                .product(name: "MediaData", package: "Media"),
                .product(name: "MediaPresentation", package: "Media"),
                .product(name: "AdminDomain", package: "Admin"),
                .product(name: "AdminData", package: "Admin"),
                .product(name: "AdminPresentation", package: "Admin"),
            ],
            resources: [.process("Resources")],
            swiftSettings: swiftSettings
        ),
        .testTarget(
            name: "AedstAppCoreTests",
            dependencies: [
                "AedstAppCore", "AedstCore", "AedstPersistence", "AedstNetwork", "AedstAnalytics", "AedstTesting",
                .product(name: "AuthDomain", package: "Auth"),
                .product(name: "AuthData", package: "Auth"),
                .product(name: "AuthPresentation", package: "Auth"),
                .product(name: "TasksDomain", package: "Tasks"),
                .product(name: "TasksData", package: "Tasks"),
                .product(name: "TasksPresentation", package: "Tasks"),
                .product(name: "AdminDomain", package: "Admin"),
                .product(name: "AdminData", package: "Admin"),
                .product(name: "AdminPresentation", package: "Admin"),
            ],
            swiftSettings: swiftSettings
        ),
    ],
    swiftLanguageModes: [.v6]
)
