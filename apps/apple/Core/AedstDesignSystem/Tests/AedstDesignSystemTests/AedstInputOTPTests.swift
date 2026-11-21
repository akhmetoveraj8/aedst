// The component exists on iOS, macOS and visionOS only (see AedstInputOTP.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstInputOTP")
struct AedstInputOTPTests {
    @Test("a pasted code keeps only its digits")
    func stripsNonDigits() {
        #expect(AedstInputOTPLogic.sanitized("12 34-56", length: 6) == "123456")
        #expect(AedstInputOTPLogic.sanitized("abc", length: 6).isEmpty)
    }

    @Test("a code longer than the field is cut to its length")
    func cutsToLength() {
        #expect(AedstInputOTPLogic.sanitized("1234567890", length: 6) == "123456")
        #expect(AedstInputOTPLogic.sanitized("123", length: 0).isEmpty)
    }

    @Test("non-ASCII digits are not accepted")
    func rejectsNonASCIIDigits() {
        #expect(AedstInputOTPLogic.sanitized("١٢٣4", length: 6) == "4")
    }

    @Test("a slot shows its digit, or nothing past the end of the code")
    func digitPerSlot() {
        #expect(AedstInputOTPLogic.digit(at: 0, in: "12") == "1")
        #expect(AedstInputOTPLogic.digit(at: 1, in: "12") == "2")
        #expect(AedstInputOTPLogic.digit(at: 2, in: "12") == nil)
        #expect(AedstInputOTPLogic.digit(at: -1, in: "12") == nil)
    }
}
#endif
