import Foundation
import Testing

/// A clone without the generated Connect stubs does not get this far: the module does not
/// compile, and `GeneratedStubsSentinel.swift` says why. This test covers the other failure
/// mode, a PARTIAL or stale `Generated/` folder (an interrupted or older `make generate`),
/// and names the fix instead of leaving a missing-symbol puzzle for `ProtoContractTests`.
@Suite("Generated Connect stubs")
struct GeneratedStubsTests {
    /// Services the app calls; must match the `--path` list of `make generate`.
    private static let services = ["admin", "appattest", "auth", "capabilities", "media", "notifications", "search", "tasks"]

    private var generatedDirectory: URL {
        // .../Core/AedstNetwork/Tests/AedstNetworkTests/<this file>
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // AedstNetworkTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // AedstNetwork
            .appendingPathComponent("Sources/AedstNetwork/Generated")
    }

    @Test("every service has its generated messages and client (otherwise: run `make bootstrap` in apps/apple)")
    func stubsArePresent() {
        var fileNames: Set<String> = []
        if let enumerator = FileManager.default.enumerator(atPath: generatedDirectory.path) {
            for case let path as String in enumerator {
                fileNames.insert((path as NSString).lastPathComponent)
            }
        }

        var missing: [String] = []
        for service in Self.services {
            for suffix in ["pb.swift", "connect.swift"] where !fileNames.contains("\(service).\(suffix)") {
                missing.append("\(service).\(suffix)")
            }
        }

        #expect(
            missing.isEmpty,
            "Missing generated stubs: \(missing.joined(separator: ", ")). Run `make bootstrap` (or `make generate`) in apps/apple; the stubs are intentionally not committed."
        )
    }
}
