//! Query rules: what may be sent, and when nothing is sent at all.

/// `SearchRequest.query` maximum, in characters.
pub const MAX_QUERY_CHARS: usize = 200;
/// `SuggestRequest.prefix` maximum, in characters. A longer query asks for no suggestions.
pub const MAX_SUGGEST_CHARS: usize = 100;
/// Page size the search asks for (server default 20, clamp 50).
pub const PAGE_SIZE: u32 = 20;
/// Suggestions asked for (server default 8, clamp 20).
pub const SUGGEST_LIMIT: u32 = 8;

/// Trims whitespace and cuts to [`MAX_QUERY_CHARS`] characters (never mid-character), then trims
/// again so the cut cannot leave trailing whitespace. An empty result means "nothing to search".
#[must_use]
pub fn normalize_query(raw: &str) -> String {
    let cut: String = raw.trim().chars().take(MAX_QUERY_CHARS).collect();
    cut.trim_end().to_owned()
}

/// What the search asks for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchQuery {
    /// Already normalised, never empty.
    pub text: String,
    /// Echo of the last response's token with the same text; `None` for the first page.
    pub page_token: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_is_empty_and_text_is_trimmed() {
        assert_eq!(normalize_query(" \t\n "), "");
        assert_eq!(normalize_query("  milk \n"), "milk");
    }

    #[test]
    fn long_text_is_cut_on_characters_not_bytes() {
        let long = "Ж".repeat(250);
        let cut = normalize_query(&long);
        assert_eq!(cut.chars().count(), MAX_QUERY_CHARS);
        let spaced = format!("{}{}", "a".repeat(199), " b");
        assert_eq!(normalize_query(&spaced), "a".repeat(199));
    }
}
