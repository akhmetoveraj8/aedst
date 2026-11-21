#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@MainActor
@Suite("AedstCodeBlock")
struct AedstCodeBlockTests {
    @Test("lines are numbered from 1 and empty lines are kept")
    func numbersLines() {
        let lines = AedstCodeBlock.lines(of: "a\n\nb")
        #expect(lines.map(\.number) == [1, 2, 3])
        #expect(lines.map(\.text) == ["a", "", "b"])
    }

    @Test("one trailing newline is not an extra line")
    func dropsFinalNewline() {
        #expect(AedstCodeBlock.lines(of: "a\nb\n").map(\.text) == ["a", "b"])
        #expect(AedstCodeBlock.lines(of: "a\n\n").map(\.text) == ["a", ""])
    }

    @Test("Windows line endings are normalised")
    func normalisesLineEndings() {
        #expect(AedstCodeBlock.lines(of: "a\r\nb\r\n").map(\.text) == ["a", "b"])
    }

    @Test("empty code is one empty line")
    func emptyCode() {
        #expect(AedstCodeBlock.lines(of: "") == [AedstCodeBlock.Line(number: 1, text: "")])
    }
}
#endif
