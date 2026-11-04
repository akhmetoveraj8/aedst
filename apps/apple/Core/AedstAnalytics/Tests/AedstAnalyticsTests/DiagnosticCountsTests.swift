import Testing
@testable import AedstAnalytics

@Suite("DiagnosticCounts")
struct DiagnosticCountsTests {
    @Test("parameters are numeric, PII-free strings")
    func parameters() {
        let counts = DiagnosticCounts(crashes: 2, hangs: 1, cpuExceptions: 0, diskWriteExceptions: 3)

        #expect(counts.parameters == [
            "crashes": "2",
            "hangs": "1",
            "cpu_exceptions": "0",
            "disk_write_exceptions": "3",
        ])
        #expect(counts.summary == "crashes=2 hangs=1 cpu=0 diskWrites=3")
    }
}
