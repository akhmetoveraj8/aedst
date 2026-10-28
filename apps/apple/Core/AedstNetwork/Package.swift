// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AedstNetwork",
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
        .library(name: "AedstNetwork", targets: ["AedstNetwork"]),
    ],
    dependencies: [
        .package(path: "../AedstCore"),
        .package(path: "../AedstTesting"),
        // Generated ConnectRPC stubs (see ../../buf.gen.yaml) import these two. Floors are the latest
        // stable releases, verified 2026-10-28 via git ls-remote --tags: connect-swift 1.2.3,
        // swift-protobuf 1.39.0. CI builds protoc-gen-swift / protoc-gen-connect-swift from the SAME
        // tags (apple-ci.yml passes them to .github/actions/apple-codegen) so generator == runtime.
        .package(url: "https://github.com/connectrpc/connect-swift", from: "1.2.3"),
        .package(url: "https://github.com/apple/swift-protobuf", from: "1.39.0"),
    ],
    targets: [
        .target(
            name: "AedstNetwork",
            dependencies: [
                "AedstCore",
                .product(name: "Connect", package: "connect-swift"),
                .product(name: "SwiftProtobuf", package: "swift-protobuf"),
            ],
            exclude: ["Generated/README.md"],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
        .testTarget(
            name: "AedstNetworkTests",
            dependencies: ["AedstNetwork", "AedstCore", "AedstTesting"],
            swiftSettings: [.swiftLanguageMode(.v6)]
        ),
    ]
)
