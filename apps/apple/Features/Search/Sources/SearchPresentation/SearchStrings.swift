import Foundation

/// The Search String Catalog (`Resources/Localizable.xcstrings`) lives in this target, the one place both UI builds
/// (`SearchUIiOS`, `SearchUIMac`) share. Views pass `SearchStrings.bundle` to `String(localized:bundle:)`: a UI target
/// has no resources of its own, so its `Bundle.module` does not exist.
public enum SearchStrings {
    /// The resource bundle that holds the catalog.
    public static var bundle: Bundle { .module }
}
