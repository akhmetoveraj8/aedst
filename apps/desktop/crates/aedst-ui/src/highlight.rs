//! Syntax highlighting for `AedstCodeBlock`: splits source code into lines of coloured spans.
//!
//! Tokenising is done by `syntect` (the Sublime Text syntaxes bundled with it, on the pure-Rust
//! regex engine). Its TextMate scopes are mapped to the seven syntax tokens of the kit
//! (`AedstTokens.syntax-*`), plus [`TokenKind::Plain`] for everything else. The result is plain
//! Rust data: each crate that shows a code block converts it to its own Slint-generated
//! `AedstCodeLine` / `AedstCodeSpan` / `AedstCodeTokenKind` types (one `match` on [`TokenKind`]).
//!
//! Loading the syntax set takes a few milliseconds and happens once, on the first call; call
//! [`highlight`] off the UI thread for long sources.

use std::sync::OnceLock;

use syntect::parsing::{ParseState, ScopeStack, SyntaxReference, SyntaxSet};

/// The colour class of a span; mirrors the Slint enum `AedstCodeTokenKind` (`String` is
/// `string-literal`, `Number` `number-literal`, `Function` `function-name`, `Type` `type-name`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TokenKind {
    /// Identifiers, whitespace and anything without a token colour (`AedstTokens.foreground`).
    Plain,
    /// `AedstTokens.syntax-comment`.
    Comment,
    /// `AedstTokens.syntax-keyword`, storage keywords (`fn`, `let`) and `true`/`null` included.
    Keyword,
    /// `AedstTokens.syntax-string`, quotes included.
    String,
    /// `AedstTokens.syntax-number`.
    Number,
    /// `AedstTokens.syntax-function`: declared and called function names.
    Function,
    /// `AedstTokens.syntax-type`: type, class, struct, enum and trait names.
    Type,
    /// `AedstTokens.syntax-punctuation`: punctuation and operators.
    Punctuation,
}

/// A run of text of one [`TokenKind`]. The spans of a line concatenate to the line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Span {
    /// The text, without the line break.
    pub text: String,
    /// Its colour class.
    pub kind: TokenKind,
}

/// The syntaxes bundled with syntect (newline-terminated variant), loaded on first use.
fn syntaxes() -> &'static SyntaxSet {
    static SYNTAXES: OnceLock<SyntaxSet> = OnceLock::new();
    SYNTAXES.get_or_init(SyntaxSet::load_defaults_newlines)
}

/// Splits `code` into lines (`\n` or `\r\n`) of highlighted spans.
///
/// `language` is a name or file extension as on web (`rust`, `rs`, `python`, `json`, ...),
/// matched case-insensitively. An unknown or empty language, or a syntax error inside the
/// tokenizer, yields [`TokenKind::Plain`] spans: the text is never lost. An empty line has no span.
#[must_use]
pub fn highlight(code: &str, language: &str) -> Vec<Vec<Span>> {
    let set = syntaxes();
    let syntax = find_syntax(set, language);
    let mut state = ParseState::new(syntax);
    let mut stack = ScopeStack::new();
    let mut failed = false;
    let mut lines = Vec::new();
    for raw in code.split_inclusive('\n') {
        let line = raw.trim_end_matches(['\n', '\r']);
        let spans = if failed {
            plain(line)
        } else if let Some(spans) = tokenize_line(raw, line.len(), set, &mut state, &mut stack) {
            spans
        } else {
            // The parser state is unknown after an error: the rest of the block stays plain.
            failed = true;
            plain(line)
        };
        lines.push(spans);
    }
    lines
}

/// The syntax for a language name or extension; plain text when none matches.
fn find_syntax<'a>(set: &'a SyntaxSet, language: &str) -> &'a SyntaxReference {
    let language = language.trim();
    if language.is_empty() {
        return set.find_syntax_plain_text();
    }
    // Matches file extensions and, case-insensitively, syntax names.
    set.find_syntax_by_token(language)
        .unwrap_or_else(|| set.find_syntax_plain_text())
}

/// One line as spans, or `None` when syntect reports an error. `raw` keeps its line break (the
/// bundled syntaxes expect it); only the first `visible` bytes become spans.
fn tokenize_line(
    raw: &str,
    visible: usize,
    set: &SyntaxSet,
    state: &mut ParseState,
    stack: &mut ScopeStack,
) -> Option<Vec<Span>> {
    let ops = state.parse_line(raw, set).ok()?;
    let mut spans: Vec<Span> = Vec::new();
    let mut start = 0;
    // Each op applies at a byte offset; the text before it carries the scopes of the stack so far.
    for (offset, op) in &ops {
        start = emit(&mut spans, raw, start, (*offset).min(visible), stack);
        stack.apply(op).ok()?;
    }
    emit(&mut spans, raw, start, visible, stack);
    Some(spans)
}

/// Appends `raw[start..end]` with the kind of the current scopes; returns the new start.
fn emit(spans: &mut Vec<Span>, raw: &str, start: usize, end: usize, stack: &ScopeStack) -> usize {
    if end <= start {
        return start;
    }
    let text = &raw[start..end];
    let kind = kind_of(stack);
    match spans.last_mut() {
        Some(last) if last.kind == kind => last.text.push_str(text),
        _ => spans.push(Span {
            text: text.to_owned(),
            kind,
        }),
    }
    end
}

fn plain(line: &str) -> Vec<Span> {
    if line.is_empty() {
        Vec::new()
    } else {
        vec![Span {
            text: line.to_owned(),
            kind: TokenKind::Plain,
        }]
    }
}

/// The token kind of the innermost scopes. Comments and strings win from any depth (the quotes of
/// a string are `punctuation.definition.string` inside `string`); otherwise the innermost scope
/// with a mapping decides.
fn kind_of(stack: &ScopeStack) -> TokenKind {
    let names: Vec<String> = stack
        .as_slice()
        .iter()
        .map(|scope| scope.build_string())
        .collect();
    let innermost_first = || names.iter().rev().map(String::as_str);
    innermost_first()
        .find_map(enclosing_kind)
        .or_else(|| innermost_first().find_map(scope_kind))
        .unwrap_or(TokenKind::Plain)
}

fn enclosing_kind(scope: &str) -> Option<TokenKind> {
    if has_prefix(scope, "comment") {
        Some(TokenKind::Comment)
    } else if has_prefix(scope, "string") {
        Some(TokenKind::String)
    } else {
        None
    }
}

/// Maps one TextMate scope name (`keyword.control.rust`) to a token kind.
fn scope_kind(scope: &str) -> Option<TokenKind> {
    const RULES: &[(&str, TokenKind)] = &[
        ("constant.numeric", TokenKind::Number),
        ("constant.language", TokenKind::Keyword),
        ("keyword.operator", TokenKind::Punctuation),
        ("keyword", TokenKind::Keyword),
        ("storage", TokenKind::Keyword),
        ("entity.name.function", TokenKind::Function),
        ("support.function", TokenKind::Function),
        ("variable.function", TokenKind::Function),
        ("meta.function-call.identifier", TokenKind::Function),
        ("entity.name.type", TokenKind::Type),
        ("entity.name.class", TokenKind::Type),
        ("entity.name.struct", TokenKind::Type),
        ("entity.name.enum", TokenKind::Type),
        ("entity.name.trait", TokenKind::Type),
        ("entity.name.interface", TokenKind::Type),
        ("entity.other.inherited-class", TokenKind::Type),
        ("support.type", TokenKind::Type),
        ("support.class", TokenKind::Type),
        ("entity.name.tag", TokenKind::Keyword),
        ("punctuation", TokenKind::Punctuation),
    ];
    RULES
        .iter()
        .find(|(prefix, _)| has_prefix(scope, prefix))
        .map(|(_, kind)| *kind)
}

/// `scope` is `prefix` or starts with `prefix.` (TextMate scope matching is by whole atoms).
fn has_prefix(scope: &str, prefix: &str) -> bool {
    scope
        .strip_prefix(prefix)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('.'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds_of(line: &[Span], text: &str) -> Vec<TokenKind> {
        line.iter()
            .filter(|span| span.text.contains(text))
            .map(|span| span.kind)
            .collect()
    }

    #[test]
    fn spans_concatenate_to_the_source_lines() {
        let code = "fn main() {\r\n    let x = 42; // answer\n\n    println!(\"hi\");\n}";
        let lines = highlight(code, "rust");
        let expected: Vec<&str> = code.lines().collect();
        assert_eq!(lines.len(), expected.len());
        for (spans, source) in lines.iter().zip(expected) {
            let joined: String = spans.iter().map(|span| span.text.as_str()).collect();
            assert_eq!(joined, source);
        }
    }

    #[test]
    fn rust_tokens_get_their_kinds() {
        let code = "fn main() {\n    let x = 42; // answer\n    let s = \"hi\";\n}";
        let lines = highlight(code, "rust");
        assert_eq!(kinds_of(&lines[0], "fn"), vec![TokenKind::Keyword]);
        assert_eq!(kinds_of(&lines[0], "main"), vec![TokenKind::Function]);
        assert_eq!(kinds_of(&lines[1], "42"), vec![TokenKind::Number]);
        assert_eq!(kinds_of(&lines[1], "answer"), vec![TokenKind::Comment]);
        assert_eq!(kinds_of(&lines[2], "\"hi\""), vec![TokenKind::String]);
    }

    #[test]
    fn adjacent_spans_of_one_kind_are_merged() {
        let lines = highlight("// one two three", "rs");
        let expected = Span {
            text: "// one two three".to_owned(),
            kind: TokenKind::Comment,
        };
        assert_eq!(lines[0], vec![expected]);
    }

    #[test]
    fn unknown_language_is_plain_text() {
        let lines = highlight("whatever {\n}", "no-such-language");
        assert_eq!(lines, vec![plain("whatever {"), plain("}")]);
    }

    #[test]
    fn empty_lines_have_no_spans() {
        assert_eq!(highlight("a\n\nb", ""), vec![plain("a"), Vec::new(), plain("b")]);
    }

    #[test]
    fn scope_prefixes_match_whole_atoms() {
        assert_eq!(
            scope_kind("keyword.operator.assignment.rust"),
            Some(TokenKind::Punctuation)
        );
        assert_eq!(scope_kind("keyword.control.rust"), Some(TokenKind::Keyword));
        assert_eq!(scope_kind("keywords.not.a.scope"), None);
        assert_eq!(
            scope_kind("entity.name.function.rust"),
            Some(TokenKind::Function)
        );
        assert_eq!(scope_kind("support.type.python"), Some(TokenKind::Type));
        assert_eq!(
            enclosing_kind("string.quoted.double.json"),
            Some(TokenKind::String)
        );
    }
}
