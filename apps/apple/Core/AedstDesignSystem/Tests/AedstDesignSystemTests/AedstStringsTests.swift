import Testing
@testable import AedstDesignSystem

@Suite("AedstStrings")
struct AedstStringsTests {
    @Test("every accessibility string resolves from the catalog (not the raw key)")
    func resolves() {
        let all = [
            AedstStrings.checkbox, AedstStrings.checked, AedstStrings.unchecked,
            AedstStrings.progress, AedstStrings.switchControl,
            AedstStrings.errorTitle, AedstStrings.ok, AedstStrings.retry,
            AedstStrings.loading, AedstStrings.imageUnavailable,
            AedstStrings.cancel, AedstStrings.continueAction, AedstStrings.close, AedstStrings.copy, AedstStrings.copied,
            AedstStrings.search, AedstStrings.noResults, AedstStrings.previous, AedstStrings.next,
            AedstStrings.expanded, AedstStrings.collapsed, AedstStrings.required, AedstStrings.oneTimeCode,
            AedstStrings.tracePending, AedstStrings.traceRunning, AedstStrings.traceSuccess, AedstStrings.traceError,
            AedstStrings.traceSkipped, AedstStrings.showDetails, AedstStrings.toggleSidebar,
        ]
        for text in all {
            #expect(!text.isEmpty)
            #expect(!text.hasPrefix("ds"), "unresolved localization key: \(text)")
        }
    }

    @Test("formatted strings interpolate their arguments")
    func formats() {
        #expect(AedstStrings.percent(42).contains("42"))
        #expect(AedstStrings.errorPrefix("Required").contains("Required"))
        #expect(AedstStrings.page("3").contains("3"))
        #expect(AedstStrings.sortBy("Name").contains("Name"))
        let pageOf = AedstStrings.pageOf("3", "10")
        #expect(pageOf.contains("3") && pageOf.contains("10"))
        let slideOf = AedstStrings.slideOf("2", "5")
        #expect(slideOf.contains("2") && slideOf.contains("5"))
    }
}
