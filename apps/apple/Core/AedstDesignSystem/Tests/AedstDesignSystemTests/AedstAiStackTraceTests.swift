// The component exists on iOS, macOS and visionOS only (see AedstAiStackTrace.swift).
#if os(iOS) || os(macOS) || os(visionOS)
import Testing
@testable import AedstDesignSystem

@Suite("AedstAiStackTrace")
struct AedstAiStackTraceTests {
    private let stack = """
        TypeError: Cannot read properties of undefined
            at renderList (src/ui/list.tsx:42:17)
            at src/app.tsx:12:3
            at renderWithHooks (node_modules/react-dom/index.js:16305:18)
        handle@https://example.test/app.js:7:9

            at node:internal/process/task_queues:95:5
        """

    @Test("the first line is the error and blank lines are dropped")
    func errorLine() {
        let parsed = AedstAiStackTraceParser.parse(stack)
        #expect(parsed.error == "TypeError: Cannot read properties of undefined")
        #expect(parsed.frames.count == 5)
    }

    @Test("V8 frames with and without a function name are parsed")
    func v8Frames() {
        let frames = AedstAiStackTraceParser.parse(stack).frames
        #expect(frames[0] == AedstAiStackFrame(
            raw: "at renderList (src/ui/list.tsx:42:17)", functionName: "renderList", file: "src/ui/list.tsx",
            line: 42, column: 17, isInternal: false
        ))
        #expect(frames[1].functionName == nil)
        #expect(frames[1].file == "src/app.tsx")
        #expect(frames[1].line == 12)
    }

    @Test("Gecko frames are parsed")
    func geckoFrame() {
        let frame = AedstAiStackTraceParser.parse(stack).frames[3]
        #expect(frame.functionName == "handle")
        #expect(frame.file == "https://example.test/app.js")
        #expect(frame.column == 9)
    }

    @Test("dependency and runtime frames are internal, and split from app frames")
    func internalFrames() {
        let frames = AedstAiStackTraceParser.parse(stack).frames
        let split = AedstAiStackTraceLogic.split(frames)
        #expect(split.app.count == 3)
        #expect(split.dependency.map(\.line) == [16305, 95])
    }

    @Test("an unknown line keeps its raw text and no location; empty input has no error")
    func fallbacks() {
        let frame = AedstAiStackTraceParser.parseFrame("at <anonymous>")
        #expect(frame.file == nil)
        #expect(frame.raw == "at <anonymous>")
        #expect(AedstAiStackTraceParser.parse("") == AedstAiParsedStack(error: "", frames: []))
        #expect(AedstAiStackTraceLogic.location(file: "a.ts", line: 3) == "a.ts:3")
        #expect(AedstAiStackTraceLogic.location(file: "a.ts", line: nil) == "a.ts")
    }

    @Test("the trace and its parts build")
    @MainActor
    func builds() {
        let parsed = AedstAiStackTraceParser.parse(stack)
        _ = AedstAiStackTrace("Failed: \(parsed.error)") {
            AedstAiStackTraceError(parsed.error)
            AedstAiStackTraceFrames(frames: parsed.frames, internalFramesLabel: "2 framework frames") { _ in nil }
        }
        _ = AedstAiStackTraceHeader("Failed")
    }
}
#endif
