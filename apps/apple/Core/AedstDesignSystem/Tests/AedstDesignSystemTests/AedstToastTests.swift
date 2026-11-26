import Testing
@testable import AedstDesignSystem

@Suite("AedstToast")
struct AedstToastTests {
    @Test("each severity has its own symbol")
    func symbols() {
        let symbols = Set(AedstToastSeverity.allCases.map(\.systemImage))
        #expect(symbols.count == AedstToastSeverity.allCases.count)
    }

    @Test("a toast is spoken as its title and message")
    func spoken() {
        let toast = AedstToastData(title: "Saved", message: "Your changes are live.", severity: .success)
        #expect(AedstAnnouncementPolicy.spokenText(title: toast.title, message: toast.message) == "Saved. Your changes are live.")
    }

    @Test("the same text shown again counts as the same toast, so it does not restart")
    func equality() {
        #expect(AedstToastData(title: "Saved", severity: .info) == AedstToastData(title: "Saved", severity: .success))
        #expect(AedstToastData(title: "Saved") != AedstToastData(title: "Deleted"))
    }
}
