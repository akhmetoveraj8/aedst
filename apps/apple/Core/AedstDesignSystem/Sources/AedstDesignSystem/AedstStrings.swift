import Foundation

/// Localized strings the design system itself needs (accessibility labels,
/// values and hints baked into components). Catalog: `Resources/Localizable.xcstrings`
/// (en, ru, ar, tg, uz). Feature copy stays in each feature's own catalog.
///
/// Numbers are passed in already formatted (`value.formatted()`), so the catalog keys use `%@` and need no
/// plural variations.
enum AedstStrings {
    static func errorPrefix(_ message: String) -> String {
        String(localized: "dsErrorPrefix \(message)", bundle: .module)
    }

    static func percent(_ value: Int) -> String {
        String(localized: "dsPercent \(value)", bundle: .module)
    }

    /// "Page 3".
    static func page(_ number: String) -> String {
        String(localized: "dsPage \(number)", bundle: .module)
    }

    /// "Page 3 of 10".
    static func pageOf(_ number: String, _ total: String) -> String {
        String(localized: "dsPageOf \(number) \(total)", bundle: .module)
    }

    /// "Slide 2 of 5".
    static func slideOf(_ number: String, _ total: String) -> String {
        String(localized: "dsSlideOf \(number) \(total)", bundle: .module)
    }

    /// "Sort by Name".
    static func sortBy(_ column: String) -> String {
        String(localized: "dsSortBy \(column)", bundle: .module)
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

    static var cancel: String { String(localized: "dsCancel", bundle: .module) }
    static var continueAction: String { String(localized: "dsContinue", bundle: .module) }
    static var close: String { String(localized: "dsClose", bundle: .module) }
    static var copy: String { String(localized: "dsCopy", bundle: .module) }
    static var copied: String { String(localized: "dsCopied", bundle: .module) }
    static var wrapLines: String { String(localized: "dsWrapLines", bundle: .module) }
    static var code: String { String(localized: "dsCode", bundle: .module) }
    static var search: String { String(localized: "dsSearch", bundle: .module) }
    static var noResults: String { String(localized: "dsNoResults", bundle: .module) }
    static var clear: String { String(localized: "dsClear", bundle: .module) }
    static var previous: String { String(localized: "dsPrevious", bundle: .module) }
    static var next: String { String(localized: "dsNext", bundle: .module) }
    static var pagination: String { String(localized: "dsPagination", bundle: .module) }
    static var morePages: String { String(localized: "dsMorePages", bundle: .module) }
    static var breadcrumb: String { String(localized: "dsBreadcrumb", bundle: .module) }
    static var more: String { String(localized: "dsMore", bundle: .module) }
    static var expanded: String { String(localized: "dsExpanded", bundle: .module) }
    static var collapsed: String { String(localized: "dsCollapsed", bundle: .module) }
    static var sidebar: String { String(localized: "dsSidebar", bundle: .module) }
    static var toggleSidebar: String { String(localized: "dsToggleSidebar", bundle: .module) }
    static var previousSlide: String { String(localized: "dsPreviousSlide", bundle: .module) }
    static var nextSlide: String { String(localized: "dsNextSlide", bundle: .module) }
    static var resizeHandle: String { String(localized: "dsResizeHandle", bundle: .module) }
    static var required: String { String(localized: "dsRequired", bundle: .module) }
    static var oneTimeCode: String { String(localized: "dsOneTimeCode", bundle: .module) }
    static var sortAscending: String { String(localized: "dsSortAscending", bundle: .module) }
    static var sortDescending: String { String(localized: "dsSortDescending", bundle: .module) }
    static var selectRow: String { String(localized: "dsSelectRow", bundle: .module) }
    static var selectAllRows: String { String(localized: "dsSelectAllRows", bundle: .module) }
    static var noData: String { String(localized: "dsNoData", bundle: .module) }
    static var chart: String { String(localized: "dsChart", bundle: .module) }
    static var tracePending: String { String(localized: "dsTracePending", bundle: .module) }
    static var traceRunning: String { String(localized: "dsTraceRunning", bundle: .module) }
    static var traceSuccess: String { String(localized: "dsTraceSuccess", bundle: .module) }
    static var traceError: String { String(localized: "dsTraceError", bundle: .module) }
    static var traceSkipped: String { String(localized: "dsTraceSkipped", bundle: .module) }
    static var selectOption: String { String(localized: "dsSelectOption", bundle: .module) }
    static var showDetails: String { String(localized: "dsShowDetails", bundle: .module) }
    static var menu: String { String(localized: "dsMenu", bundle: .module) }
    static var commandPalette: String { String(localized: "dsCommandPalette", bundle: .module) }
    static var messages: String { String(localized: "dsA11yMessages", bundle: .module) }
    static var scrollToEnd: String { String(localized: "dsA11yScrollToEnd", bundle: .module) }
    static var newMessage: String { String(localized: "dsA11yNewMessage", bundle: .module) }
    static var questionnaireProgress: String { String(localized: "dsA11yQuestionnaireProgress", bundle: .module) }
    static var skip: String { String(localized: "dsActionSkip", bundle: .module) }
    static var submit: String { String(localized: "dsActionSubmit", bundle: .module) }
    static var attachmentUploading: String { String(localized: "dsA11yAttachmentUploading", bundle: .module) }
    static var attachmentProcessing: String { String(localized: "dsA11yAttachmentProcessing", bundle: .module) }
    static var attachmentFailed: String { String(localized: "dsA11yAttachmentFailed", bundle: .module) }
    static var dismissNotification: String { String(localized: "dsDismissNotification", bundle: .module) }
    static var showActions: String { String(localized: "dsShowActions", bundle: .module) }
    static var increase: String { String(localized: "dsIncrease", bundle: .module) }
    static var decrease: String { String(localized: "dsDecrease", bundle: .module) }

    /// "3 of 6 digits entered".
    static func otpDigits(_ entered: String, _ total: String) -> String {
        String(localized: "dsOTPDigits \(entered) \(total)", bundle: .module)
    }

    /// "Question 2 of 5".
    static func questionProgress(_ current: String, _ total: String) -> String {
        String(localized: "dsQuestionProgress \(current) \(total)", bundle: .module)
    }
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
    /// "Cancel".
    public static var cancel: String { AedstStrings.cancel }
    /// "Continue".
    public static var continueAction: String { AedstStrings.continueAction }
    /// "Close".
    public static var close: String { AedstStrings.close }
    /// "Search".
    public static var search: String { AedstStrings.search }
    /// "No results".
    public static var noResults: String { AedstStrings.noResults }
}
