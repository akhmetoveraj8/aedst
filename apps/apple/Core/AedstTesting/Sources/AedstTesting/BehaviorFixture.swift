import Foundation

/// Loads the shared cross-platform behaviour fixtures (`docs/contract/behavior/<name>.json`) straight from the
/// repository, so the repo file stays the single source: nothing is copied into a test bundle.
///
/// The repository root is found by walking up from the calling test file (`#filePath` is the absolute path of the
/// source at compile time, so this works for `swift test` and `xcodebuild test` on a checkout; it is not meant for
/// a test bundle that is run somewhere the sources do not exist).
public enum BehaviorFixture {
    public struct NotFound: Error, CustomStringConvertible {
        public let name: String
        public let searchedFrom: String

        public var description: String {
            "docs/contract/behavior/\(name).json not found above \(searchedFrom)"
        }
    }

    /// Raw JSON of `docs/contract/behavior/<name>.json`.
    public static func data(named name: String, from file: String = #filePath) throws -> Data {
        var directory = URL(fileURLWithPath: file).deletingLastPathComponent()
        for _ in 0..<12 {
            let candidate = directory.appendingPathComponent("docs/contract/behavior/\(name).json")
            if FileManager.default.fileExists(atPath: candidate.path) {
                return try Data(contentsOf: candidate)
            }
            directory.deleteLastPathComponent()
        }
        throw NotFound(name: name, searchedFrom: file)
    }

    /// Decodes the fixture into `type`.
    public static func load<Fixture: Decodable>(
        _ type: Fixture.Type,
        named name: String,
        from file: String = #filePath
    ) throws -> Fixture {
        try JSONDecoder().decode(type, from: data(named: name, from: file))
    }
}
