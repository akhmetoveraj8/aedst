// swift-tools-version: 6.0
import PackageDescription

#if TUIST
import ProjectDescription

// Tuist integrates every product of every package below (and their transitive
// dependencies: connect-swift, swift-protobuf, GRDB, ...) as generated Xcode
// targets, referenced from Project.swift
// with `.external(name:)`. Third-party versions are declared once, in the
// local packages' own Package.swift files (Core/*, Features/*); this manifest
// lists the composition-root package and every feature package, because the app targets link feature products
// directly (`<Feature>UIiOS` for App_iOS, `<Feature>UIMac` for App_macOS; see Project.swift).
let packageSettings = PackageSettings(
    // Tuist's default for external packages is `.staticFramework`. Keep it:
    // it avoids embedding dozens of dynamic frameworks in the app bundle.
    productTypes: [:]
)
#endif

let package = Package(
    name: "AedstDependencies",
    dependencies: [
        // Composition-root package (AedstAppCore); pulls in every Core/* package transitively.
        .package(path: "../App/Shared"),
        // Feature packages: named here so their UI products are part of the graph the app targets pick from.
        .package(path: "../Features/Auth"),
        .package(path: "../Features/Tasks"),
        .package(path: "../Features/Search"),
        .package(path: "../Features/Notifications"),
        .package(path: "../Features/Media"),
        .package(path: "../Features/Admin"),
    ],
    swiftLanguageModes: [.v6]
)
