//! Stack-trace parsing for `AedstAiStackTrace` (the Rust port of web `parseStackTrace` in
//! `apps/web/shared/ui/ai-stack-trace.tsx`).
//!
//! Splits a JavaScript `error.stack` into the error line and its frames, in V8 form
//! (`at fn (file:1:2)`, `at file:1:2`) and Firefox/Safari form (`fn@file:1:2`). Frames from
//! dependencies or the runtime (`node_modules`, `node:`, `internal/`) are marked
//! [`StackFrame::internal`]; `AedstAiStackTrace` shows the app frames and folds the rest. The
//! result is plain Rust data: each crate converts it to its own Slint-generated
//! `AedstAiStackFrame` (as with [`crate::highlight`]). Written by hand, without a regex crate,
//! because the two frame shapes need only suffix and delimiter splits.

/// One frame of a stack trace.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StackFrame {
    /// The frame as printed, trimmed.
    pub raw: String,
    /// The function name, when the frame names one.
    pub function_name: Option<String>,
    /// The file or URL, when the frame could be parsed.
    pub file: Option<String>,
    /// 1-based line, when the frame could be parsed.
    pub line: Option<u32>,
    /// 1-based column, when the frame could be parsed.
    pub column: Option<u32>,
    /// A dependency or runtime frame (`node_modules`, `node:`, `internal/`).
    pub internal: bool,
}

impl StackFrame {
    /// `file:line` for display, or the raw frame when it could not be parsed.
    #[must_use]
    pub fn location(&self) -> String {
        match (&self.file, self.line) {
            (Some(file), Some(line)) => format!("{file}:{line}"),
            _ => self.raw.clone(),
        }
    }
}

/// A parsed `error.stack`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParsedStack {
    /// The first non-empty line: `TypeError: Cannot read ...`.
    pub error: String,
    /// Every following non-empty line, parsed.
    pub frames: Vec<StackFrame>,
}

impl ParsedStack {
    /// The app frames, in order (shown one per row).
    pub fn app_frames(&self) -> impl Iterator<Item = &StackFrame> {
        self.frames.iter().filter(|frame| !frame.internal)
    }

    /// The dependency and runtime frames, in order (folded into one line).
    pub fn internal_frames(&self) -> impl Iterator<Item = &StackFrame> {
        self.frames.iter().filter(|frame| frame.internal)
    }

    /// The raw internal frames joined by `\n`: the text of the folded code block.
    #[must_use]
    pub fn internal_text(&self) -> String {
        self.internal_frames()
            .map(|frame| frame.raw.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// Splits `stack` into the error line and parsed frames. Lines are trimmed and empty lines
/// dropped; an empty input gives an empty error and no frames. Never fails: a frame that matches
/// neither shape keeps only `raw` (and `internal`, judged on the raw text).
#[must_use]
pub fn parse_stack_trace(stack: &str) -> ParsedStack {
    let mut lines = stack.lines().map(str::trim).filter(|line| !line.is_empty());
    let error = lines.next().unwrap_or_default().to_owned();
    ParsedStack {
        error,
        frames: lines.map(parse_frame).collect(),
    }
}

/// `(function, file, line, column)` of a parsed frame.
type Parts<'a> = (Option<&'a str>, &'a str, u32, u32);

fn parse_frame(raw: &str) -> StackFrame {
    let parts = parse_v8(raw).or_else(|| parse_gecko(raw));
    let location = parts.map_or(raw, |(_, file, _, _)| file);
    let mut frame = StackFrame {
        raw: raw.to_owned(),
        internal: location.contains("node_modules")
            || location.starts_with("node:")
            || location.starts_with("internal/"),
        ..StackFrame::default()
    };
    if let Some((function, file, line, column)) = parts {
        frame.function_name = function.filter(|name| !name.is_empty()).map(str::to_owned);
        frame.file = Some(file.to_owned());
        frame.line = Some(line);
        frame.column = Some(column);
    }
    frame
}

/// V8: `at fn (file:1:2)` or `at file:1:2`.
fn parse_v8(raw: &str) -> Option<Parts<'_>> {
    let rest = raw.strip_prefix("at ")?;
    if let Some((function, inner)) = rest.split_once(" (")
        && let Some(location) = inner.strip_suffix(')')
        && let Some((file, line, column)) = split_location(location)
    {
        return Some((Some(function), file, line, column));
    }
    let location = rest.strip_suffix(')').unwrap_or(rest);
    let (file, line, column) = split_location(location)?;
    Some((None, file, line, column))
}

/// Firefox/Safari: `fn@file:1:2` (an empty name for anonymous functions).
fn parse_gecko(raw: &str) -> Option<Parts<'_>> {
    let (function, location) = raw.split_once('@')?;
    let (file, line, column) = split_location(location)?;
    Some((Some(function), file, line, column))
}

/// `file:line:column` with a non-empty file (which may itself contain `:`, as in URLs).
fn split_location(location: &str) -> Option<(&str, u32, u32)> {
    let (rest, column) = location.rsplit_once(':')?;
    let (file, line) = rest.rsplit_once(':')?;
    if file.is_empty() {
        return None;
    }
    Some((file, digits(line)?, digits(column)?))
}

fn digits(text: &str) -> Option<u32> {
    if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    text.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const STACK: &str = "TypeError: Cannot read properties of undefined (reading 'id')\n    at renderRow (src/table.tsx:42:13)\n    at src/app.tsx:7:1\n\n    at Array.map (<anonymous>)\n    at commit (node_modules/react-dom/client.js:100:5)\n    at node:internal/process/task_queues:95:5";

    #[test]
    fn splits_the_error_line_from_the_frames() {
        let parsed = parse_stack_trace(STACK);
        assert_eq!(parsed.error, "TypeError: Cannot read properties of undefined (reading 'id')");
        assert_eq!(parsed.frames.len(), 5);
    }

    #[test]
    fn parses_v8_frames_with_and_without_a_function() {
        let parsed = parse_stack_trace(STACK);
        let named = &parsed.frames[0];
        assert_eq!(named.function_name.as_deref(), Some("renderRow"));
        assert_eq!(named.file.as_deref(), Some("src/table.tsx"));
        assert_eq!((named.line, named.column), (Some(42), Some(13)));
        assert!(!named.internal);
        let bare = &parsed.frames[1];
        assert_eq!(bare.function_name, None);
        assert_eq!(bare.location(), "src/app.tsx:7");
    }

    #[test]
    fn keeps_unparsable_frames_raw() {
        let frame = &parse_stack_trace(STACK).frames[2];
        assert_eq!(frame.raw, "at Array.map (<anonymous>)");
        assert_eq!((frame.file.as_deref(), frame.line), (None, None));
        assert_eq!(frame.location(), frame.raw);
        assert!(!frame.internal);
    }

    #[test]
    fn marks_dependency_and_runtime_frames_internal() {
        let parsed = parse_stack_trace(STACK);
        assert!(parsed.frames[3].internal);
        assert!(parsed.frames[4].internal);
        assert_eq!(parsed.app_frames().count(), 3);
        assert_eq!(
            parsed.internal_text(),
            "at commit (node_modules/react-dom/client.js:100:5)\nat node:internal/process/task_queues:95:5"
        );
    }

    #[test]
    fn parses_gecko_frames_and_urls() {
        let parsed = parse_stack_trace(
            "Error: boom\nhandle@https://example.test/app.js:10:20\n@https://example.test/vendor.js:1:2",
        );
        let named = &parsed.frames[0];
        assert_eq!(named.function_name.as_deref(), Some("handle"));
        assert_eq!(named.file.as_deref(), Some("https://example.test/app.js"));
        assert_eq!((named.line, named.column), (Some(10), Some(20)));
        assert_eq!(parsed.frames[1].function_name, None);
    }

    #[test]
    fn handles_crlf_and_empty_input() {
        let parsed = parse_stack_trace("Error: x\r\n  at f (a.js:1:2)\r\n");
        assert_eq!(parsed.error, "Error: x");
        assert_eq!(parsed.frames[0].file.as_deref(), Some("a.js"));
        assert_eq!(parse_stack_trace("   \n"), ParsedStack::default());
    }
}
