import Foundation

/// The Auth String Catalog (`Resources/Localizable.xcstrings`) lives in this target, the one place both UI builds
/// (`AuthUIiOS`, `AuthUIMac`) share. Views pass `AuthStrings.bundle` to `String(localized:bundle:)`: a UI target
/// has no resources of its own, so its `Bundle.module` does not exist.
public enum AuthStrings {
    /// The resource bundle that holds the catalog.
    public static var bundle: Bundle { .module }
}
