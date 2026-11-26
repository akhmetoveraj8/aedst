import Foundation

/// One frame of a JavaScript-style stack trace (the format agent tools print), as on web.
public struct AedstAiStackFrame: Sendable, Equatable {
    /// The frame as printed, trimmed.
    public let raw: String
    public let functionName: String?
    public let file: String?
    public let line: Int?
    public let column: Int?
    /// A dependency or runtime frame (`node_modules`, `node:`, `internal/`).
    public let isInternal: Bool

    public init(raw: String, functionName: String? = nil, file: String? = nil, line: Int? = nil, column: Int? = nil, isInternal: Bool) {
        self.raw = raw
        self.functionName = functionName
        self.file = file
        self.line = line
        self.column = column
        self.isInternal = isInternal
    }
}

/// The error line and the frames of a stack trace.
public struct AedstAiParsedStack: Sendable, Equatable {
    /// The first line: "TypeError: Cannot read ...".
    public let error: String
    public let frames: [AedstAiStackFrame]

    public init(error: String, frames: [AedstAiStackFrame]) {
        self.error = error
        self.frames = frames
    }
}

/// Splits a stack trace into the error line and parsed frames (web `parseStackTrace`): V8 `at fn (file:1:2)` /
/// `at file:1:2` and Firefox/Safari `fn@file:1:2`. Pure and unit-tested; call it off the main actor for long traces.
public enum AedstAiStackTraceParser {
    public static func parse(_ stack: String) -> AedstAiParsedStack {
        let lines = stack
            .split(whereSeparator: \.isNewline)
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard let first = lines.first else { return AedstAiParsedStack(error: "", frames: []) }
        return AedstAiParsedStack(error: first, frames: lines.dropFirst().map(parseFrame))
    }

    static func parseFrame(_ raw: String) -> AedstAiStackFrame {
        if let match = raw.wholeMatch(of: #/at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?/#) {
            return frame(raw, function: match.1.map(String.init), file: String(match.2), line: match.3, column: match.4)
        }
        if let match = raw.wholeMatch(of: #/(.*?)@(.+?):(\d+):(\d+)/#) {
            let function = match.1.isEmpty ? nil : String(match.1)
            return frame(raw, function: function, file: String(match.2), line: match.3, column: match.4)
        }
        return AedstAiStackFrame(raw: raw, isInternal: isInternal(raw))
    }

    private static func frame(
        _ raw: String, function: String?, file: String, line: Substring, column: Substring
    ) -> AedstAiStackFrame {
        AedstAiStackFrame(
            raw: raw,
            functionName: function,
            file: file,
            line: Int(line),
            column: Int(column),
            isInternal: isInternal(file)
        )
    }

    static func isInternal(_ location: String) -> Bool {
        location.contains("node_modules") || location.hasPrefix("node:") || location.hasPrefix("internal/")
    }
}
