//! Client-side validation. It mirrors the proto (`buf.validate`) limits, in code points.

use super::task::TaskPriority;

/// Longest title, in code points.
pub const MAX_TITLE: usize = 200;
/// Longest description, in code points.
pub const MAX_DESCRIPTION: usize = 4000;

/// Why a create was refused before any request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValidationError {
    /// The title is empty after trimming.
    TitleRequired,
    /// More than 200 code points.
    TitleTooLong,
    /// More than 4000 code points.
    DescriptionTooLong,
    /// No priority (or `unknown`).
    PriorityRequired,
}

impl ValidationError {
    /// Translation key suffix (`tasks.form.<key>`).
    #[must_use]
    pub fn key(self) -> &'static str {
        match self {
            Self::TitleRequired => "titleRequired",
            Self::TitleTooLong => "titleTooLong",
            Self::DescriptionTooLong => "descriptionTooLong",
            Self::PriorityRequired => "priorityRequired",
        }
    }
}

/// A create that passed validation.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewTask {
    /// Trimmed title.
    pub title: String,
    /// Description as typed.
    pub description: String,
    /// A real priority, never `Unknown`.
    pub priority: TaskPriority,
    /// Optional due day, Unix seconds (local midnight of the entered day).
    pub due_date: Option<i64>,
}

impl NewTask {
    /// Validates user input.
    ///
    /// # Errors
    /// The first [`ValidationError`] found, in field order.
    pub fn validate(
        title: &str,
        description: &str,
        priority: Option<TaskPriority>,
        due_date: Option<i64>,
    ) -> Result<Self, ValidationError> {
        let title = title.trim();
        if title.is_empty() {
            return Err(ValidationError::TitleRequired);
        }
        if title.chars().count() > MAX_TITLE {
            return Err(ValidationError::TitleTooLong);
        }
        if description.chars().count() > MAX_DESCRIPTION {
            return Err(ValidationError::DescriptionTooLong);
        }
        match priority {
            Some(p) if p != TaskPriority::Unknown => Ok(Self {
                title: title.to_owned(),
                description: description.to_owned(),
                priority: p,
                due_date,
            }),
            _ => Err(ValidationError::PriorityRequired),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(title: &str) -> Result<NewTask, ValidationError> {
        NewTask::validate(title, "", Some(TaskPriority::Medium), None)
    }

    #[test]
    fn title_is_trimmed_and_required() {
        assert_eq!(ok("  buy milk  ").unwrap().title, "buy milk");
        assert_eq!(ok("   "), Err(ValidationError::TitleRequired));
        assert_eq!(ok(""), Err(ValidationError::TitleRequired));
    }

    #[test]
    fn limits_count_code_points_not_bytes() {
        assert!(
            ok(&"я".repeat(MAX_TITLE)).is_ok(),
            "200 Cyrillic letters are 400 bytes but 200 code points"
        );
        assert_eq!(
            ok(&"я".repeat(MAX_TITLE + 1)),
            Err(ValidationError::TitleTooLong)
        );
        let long = "م".repeat(MAX_DESCRIPTION + 1);
        assert_eq!(
            NewTask::validate("t", &long, Some(TaskPriority::Low), None),
            Err(ValidationError::DescriptionTooLong)
        );
    }

    #[test]
    fn a_real_priority_is_required() {
        assert_eq!(
            NewTask::validate("t", "", None, None),
            Err(ValidationError::PriorityRequired)
        );
        assert_eq!(
            NewTask::validate("t", "", Some(TaskPriority::Unknown), None),
            Err(ValidationError::PriorityRequired)
        );
    }

    #[test]
    fn picker_keys_never_yield_unknown() {
        assert_eq!(
            TaskPriority::from_picker_key("urgent"),
            Some(TaskPriority::Urgent)
        );
        assert_eq!(TaskPriority::from_picker_key("unknown"), None);
        assert_eq!(TaskPriority::from_picker_key(""), None);
    }
}
