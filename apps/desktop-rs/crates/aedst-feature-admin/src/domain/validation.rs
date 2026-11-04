//! Client-side validation. It mirrors the proto (`buf.validate`) limits, in code points.

use uuid::Uuid;

/// Longest broadcast title.
pub const MAX_TITLE: usize = 120;
/// Longest broadcast body.
pub const MAX_BODY: usize = 1000;
/// Longest broadcast link.
pub const MAX_LINK: usize = 500;
/// Shortest delete reason.
pub const MIN_REASON: usize = 3;
/// Longest delete reason.
pub const MAX_REASON: usize = 500;

/// Why input was refused before any request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValidationError {
    /// A user or owner id that is not a UUID.
    IdInvalid,
    /// Empty title.
    TitleRequired,
    /// Title over 120 code points.
    TitleTooLong,
    /// Body over 1000 code points.
    BodyTooLong,
    /// Link is not a relative in-app path (`/x`, not `//x`, no line breaks, at most 500).
    LinkInvalid,
    /// Delete reason under 3 code points.
    ReasonTooShort,
    /// Delete reason over 500 code points.
    ReasonTooLong,
}

impl ValidationError {
    /// Translation key used by the view.
    #[must_use]
    pub fn key(self) -> &'static str {
        match self {
            Self::IdInvalid => "idInvalid",
            Self::TitleRequired => "titleRequired",
            Self::TitleTooLong => "titleTooLong",
            Self::BodyTooLong => "bodyTooLong",
            Self::LinkInvalid => "linkInvalid",
            Self::ReasonTooShort => "reasonTooShort",
            Self::ReasonTooLong => "reasonTooLong",
        }
    }
}

/// Canonical (hyphenated) UUID, which is what the proto's `uuid` rule accepts.
fn canonical_uuid(text: &str) -> Option<String> {
    if text.len() != 36 {
        return None;
    }
    Uuid::parse_str(text)
        .ok()
        .map(|u| u.hyphenated().to_string())
}

/// A user or owner id field: empty means "not set" (everyone).
///
/// # Errors
/// [`ValidationError::IdInvalid`] when the text is not a UUID.
pub fn parse_owner_filter(text: &str) -> Result<Option<String>, ValidationError> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(None);
    }
    canonical_uuid(text)
        .map(Some)
        .ok_or(ValidationError::IdInvalid)
}

/// The reason for deleting a task (trimmed, 3..=500 code points).
///
/// # Errors
/// [`ValidationError::ReasonTooShort`] or [`ValidationError::ReasonTooLong`].
pub fn validate_reason(reason: &str) -> Result<String, ValidationError> {
    let reason = reason.trim();
    match reason.chars().count() {
        n if n < MIN_REASON => Err(ValidationError::ReasonTooShort),
        n if n > MAX_REASON => Err(ValidationError::ReasonTooLong),
        _ => Ok(reason.to_owned()),
    }
}

/// A broadcast that passed validation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BroadcastDraft {
    /// One recipient, or `None` for everyone.
    pub user_id: Option<String>,
    /// Trimmed title (1..=120).
    pub title: String,
    /// Body (at most 1000).
    pub body: String,
    /// Empty, or a relative in-app path.
    pub link: String,
}

impl BroadcastDraft {
    /// Validates operator input.
    ///
    /// # Errors
    /// The first [`ValidationError`] found, in field order (user, title, body, link).
    pub fn validate(
        user_id: &str,
        title: &str,
        body: &str,
        link: &str,
    ) -> Result<Self, ValidationError> {
        let user_id = parse_owner_filter(user_id)?;
        let title = title.trim();
        if title.is_empty() {
            return Err(ValidationError::TitleRequired);
        }
        if title.chars().count() > MAX_TITLE {
            return Err(ValidationError::TitleTooLong);
        }
        if body.chars().count() > MAX_BODY {
            return Err(ValidationError::BodyTooLong);
        }
        let link = link.trim();
        if !is_valid_link(link) {
            return Err(ValidationError::LinkInvalid);
        }
        Ok(Self {
            user_id,
            title: title.to_owned(),
            body: body.to_owned(),
            link: link.to_owned(),
        })
    }
}

/// The proto pattern `^(/[^/].*)?$`: empty, or `/` followed by a non-`/` character; `.` does not
/// match a line break.
fn is_valid_link(link: &str) -> bool {
    if link.is_empty() {
        return true;
    }
    let mut chars = link.chars();
    chars.next() == Some('/')
        && chars.next().is_some_and(|c| c != '/')
        && !link.contains(['\n', '\r'])
        && link.chars().count() <= MAX_LINK
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "00000000-0000-4000-8000-000000000001";

    #[test]
    fn links_must_be_relative_in_app_paths() {
        for ok in ["", "/tasks", "/tasks/1?x=y"] {
            assert!(is_valid_link(ok), "{ok}");
        }
        for bad in ["/", "//evil.example", "https://x.example", "tasks", "/a\nb"] {
            assert!(!is_valid_link(bad), "{bad}");
        }
        assert!(!is_valid_link(&format!("/{}", "a".repeat(500))));
    }

    #[test]
    fn limits_count_code_points_not_bytes() {
        assert!(BroadcastDraft::validate("", &"я".repeat(120), "", "").is_ok());
        assert_eq!(
            BroadcastDraft::validate("", &"я".repeat(121), "", ""),
            Err(ValidationError::TitleTooLong)
        );
        assert!(validate_reason("абв").is_ok());
        assert_eq!(
            validate_reason(" ab "),
            Err(ValidationError::ReasonTooShort)
        );
        assert_eq!(
            validate_reason(&"x".repeat(501)),
            Err(ValidationError::ReasonTooLong)
        );
    }

    #[test]
    fn the_target_user_is_optional_but_must_be_a_canonical_uuid() {
        assert_eq!(parse_owner_filter("  "), Ok(None));
        assert_eq!(parse_owner_filter(ID), Ok(Some(ID.to_owned())));
        assert_eq!(parse_owner_filter("nope"), Err(ValidationError::IdInvalid));
        assert_eq!(
            parse_owner_filter("00000000000040008000000000000001"),
            Err(ValidationError::IdInvalid)
        );
        assert_eq!(
            BroadcastDraft::validate(ID, "  Hi ", "b", "/x").map(|d| (d.title, d.user_id)),
            Ok(("Hi".to_owned(), Some(ID.to_owned())))
        );
    }

    #[test]
    fn a_blank_title_is_refused() {
        assert_eq!(
            BroadcastDraft::validate("", "   ", "", ""),
            Err(ValidationError::TitleRequired)
        );
    }
}
