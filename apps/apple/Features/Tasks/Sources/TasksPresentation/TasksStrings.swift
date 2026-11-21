import Foundation

/// The Tasks String Catalog (`Resources/Localizable.xcstrings`) lives in this target, the one place both UI builds
/// (`TasksUIiOS`, `TasksUIMac`) share. Views pass `TasksStrings.bundle` to `String(localized:bundle:)`: a UI target
/// has no resources of its own, so its `Bundle.module` does not exist.
public enum TasksStrings {
    /// The resource bundle that holds the catalog.
    public static var bundle: Bundle { .module }
}
