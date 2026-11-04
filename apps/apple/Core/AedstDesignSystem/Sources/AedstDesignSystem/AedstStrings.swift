import Foundation

/// Localized strings the design system itself needs (accessibility labels,
/// values and hints baked into components). Catalog: `Resources/Localizable.xcstrings`
/// (en, ru, ar, tg, uz). Feature copy stays in each feature's own catalog.
enum AedstStrings {
    static func errorPrefix(_ message: String) -> String {
        String(localized: "dsErrorPrefix \(message)", bundle: .module)
    }

    static func percent(_ value: Int) -> String {
        String(localized: "dsPercent \(value)", bundle: .module)
    }

    static var errorTitle: String { String(localized: "dsErrorTitle", bundle: .module) }
    static var ok: String { String(localized: "dsOK", bundle: .module) }
    static var retry: String { String(localized: "dsRetry", bundle: .module) }
    static var loading: String { String(localized: "dsLoading", bundle: .module) }
    static var imageUnavailable: String { String(localized: "dsImageUnavailable", bundle: .module) }
    static var checkbox: String { String(localized: "dsCheckbox", bundle: .module) }
    static var checked: String { String(localized: "dsChecked", bundle: .module) }
    static var unchecked: String { String(localized: "dsUnchecked", bundle: .module) }
    static var progress: String { String(localized: "dsProgress", bundle: .module) }
    static var switchControl: String { String(localized: "dsSwitch", bundle: .module) }
}

/// Design-system strings other packages may reuse (localized in this package's catalog).
public enum AedstCommonStrings {
    /// "Try again".
    public static var retry: String { AedstStrings.retry }
    /// "OK".
    public static var ok: String { AedstStrings.ok }
    /// "Loading".
    public static var loading: String { AedstStrings.loading }
    /// "Image unavailable".
    public static var imageUnavailable: String { AedstStrings.imageUnavailable }
    /// "Something went wrong".
    public static var errorTitle: String { AedstStrings.errorTitle }
}
