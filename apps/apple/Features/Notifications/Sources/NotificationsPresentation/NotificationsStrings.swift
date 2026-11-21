import Foundation

/// The Notifications String Catalog (`Resources/Localizable.xcstrings`) lives in this target, the one place both UI builds
/// (`NotificationsUIiOS`, `NotificationsUIMac`) share. Views pass `NotificationsStrings.bundle` to `String(localized:bundle:)`: a UI target
/// has no resources of its own, so its `Bundle.module` does not exist.
public enum NotificationsStrings {
    /// The resource bundle that holds the catalog.
    public static var bundle: Bundle { .module }
}
