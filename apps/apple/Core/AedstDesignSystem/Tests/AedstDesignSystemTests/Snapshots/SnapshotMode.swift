// Decides whether the pixel-snapshot suite runs at all. Reference images cannot be produced without a Mac, so
// a checkout without them must not turn every CI run red with "no reference" noise, while a checkout WITH
// them must verify strictly (a real diff always fails). See README.md in this folder.
#if os(iOS) || os(macOS)
import Foundation

/// The explicit switch is the `AEDST_SNAPSHOTS` environment variable (for `xcodebuild test` it needs the
/// `TEST_RUNNER_` prefix, which `scripts/snapshots.sh` adds):
///
/// | Value | Effect |
/// |---|---|
/// | `auto` (default) | Run only if reference images for this OS family exist; otherwise skip (reported as skipped, not passed silently) |
/// | `verify` | Always run; a missing or differing reference fails |
/// | `record` | Always run; pair with `SNAPSHOT_TESTING_RECORD=all` (the script does) to write the references |
/// | `skip` | Never run |
///
/// Recording itself is the library's switch (`SNAPSHOT_TESTING_RECORD`), not ours: verify runs pass `never`
/// so nothing is ever written during a check.
enum SnapshotMode: String {
    case auto
    case verify
    case record
    case skip

    static let current: SnapshotMode = {
        let raw = ProcessInfo.processInfo.environment["AEDST_SNAPSHOTS"]?.lowercased()
        return raw.flatMap(SnapshotMode.init(rawValue:)) ?? .auto
    }()

    /// File-name fragments of this OS family's variants (`assertComponent` names references by variant).
    private static var variantMarkers: [String] {
        #if os(iOS)
        ["iphone-", "ipad-"]
        #else
        ["mac-"]
        #endif
    }

    /// `true` when at least one recorded reference for this OS family sits next to the tests
    /// (`__Snapshots__/ComponentSnapshotTests/*.png`).
    static func hasReferences(file: String = #filePath) -> Bool {
        let directory = URL(fileURLWithPath: file)
            .deletingLastPathComponent()
            .appendingPathComponent("__Snapshots__/ComponentSnapshotTests", isDirectory: true)
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return names.contains { name in
            name.hasSuffix(".png") && variantMarkers.contains { name.contains($0) }
        }
    }

    static var shouldRun: Bool {
        switch current {
        case .skip: false
        case .verify, .record: true
        case .auto: hasReferences()
        }
    }
}
#endif
