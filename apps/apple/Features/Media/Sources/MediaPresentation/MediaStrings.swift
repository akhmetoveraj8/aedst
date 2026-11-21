import Foundation

/// The Media String Catalog (`Resources/Localizable.xcstrings`) lives in this target, the one place both UI builds
/// (`MediaUIiOS`, `MediaUIMac`) share. Views pass `MediaStrings.bundle` to `String(localized:bundle:)`: a UI target
/// has no resources of its own, so its `Bundle.module` does not exist.
public enum MediaStrings {
    /// The resource bundle that holds the catalog.
    public static var bundle: Bundle { .module }
}
