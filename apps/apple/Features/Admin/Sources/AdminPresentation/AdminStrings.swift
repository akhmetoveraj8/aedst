import Foundation

/// The Admin String Catalog (`Resources/Localizable.xcstrings`) lives in this target, the one place both UI builds
/// (`AdminUIiOS`, `AdminUIMac`) share. Views pass `AdminStrings.bundle` to `String(localized:bundle:)`: a UI target
/// has no resources of its own, so its `Bundle.module` does not exist.
public enum AdminStrings {
    /// The resource bundle that holds the catalog.
    public static var bundle: Bundle { .module }
}
