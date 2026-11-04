// swift-tools-version: 6.0
import PackageDescription

#if TUIST
import ProjectDescription

// Tuist integrates every product of every package below (and their transitive
// dependencies: connect-swift, swift-protobuf, GRDB, ...) as generated Xcode
// targets, referenced from Project.swift
// with `.external(name:)`. Third-party versions are declared once, in the
// local packages' own Package.swift files (Core/*, Features/*); this manifest
// only lists the single package the app targets consume.
let packageSettings = PackageSettings(
    // Tuist's default for external packages is `.staticFramework`. Keep it:
    // it avoids embedding dozens of dynamic frameworks in the app bundle.
    productTypes: [:]
)
#endif

let package = Package(
    name: "AedstDependencies",
    dependencies: [
        // Composition-root package; pulls in every Core/* and Features/* package transitively.
        .package(path: "../App/Shared"),
    ],
    swiftLanguageModes: [.v6]
)
