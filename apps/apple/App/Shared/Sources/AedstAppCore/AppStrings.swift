import Foundation

/// The app-shell String Catalog (`Resources/Localizable.xcstrings`) lives in this package. The app targets
/// (`App_iOS`, `App_macOS`) are not SwiftPM targets and have no `Bundle.module`, so their views pass
/// `AppStrings.bundle` to `String(localized:bundle:)`.
public enum AppStrings {
    /// The resource bundle that holds the catalog.
    public static var bundle: Bundle { .module }
}
