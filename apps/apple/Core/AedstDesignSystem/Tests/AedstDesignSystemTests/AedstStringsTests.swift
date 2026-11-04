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
    }
}
