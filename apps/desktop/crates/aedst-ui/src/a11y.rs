//! User accessibility preferences that Slint cannot read from the operating system: reduced motion
//! and high contrast. The kit reads them from the `AedstA11y` global (`ui/aedst_a11y.slint`); the
//! application sets that global once at startup and again when its settings change.
//!
//! Detection is deliberately minimal. No approved crate reads the Windows settings
//! (`SystemParametersInfo` `SPI_GETCLIENTAREAANIMATION` / `SPI_GETHIGHCONTRAST`; a crate such as
//! `windows-registry` would need the add-dependency process), so the preferences come from the
//! environment: `AEDST_REDUCE_MOTION` and `AEDST_HIGH_CONTRAST` (`1`, `true`, `yes` or `on`; case
//! does not matter) and, for the stored user setting, from the caller through [`A11yPreferences::new`].

/// Environment variable that turns reduced motion on.
pub const REDUCE_MOTION_VAR: &str = "AEDST_REDUCE_MOTION";
/// Environment variable that turns high contrast on.
pub const HIGH_CONTRAST_VAR: &str = "AEDST_HIGH_CONTRAST";

/// The two preferences the kit honours.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct A11yPreferences {
    /// Skip animations: carousel, progress, switch, sheet and drawer, spinner, skeleton.
    pub reduce_motion: bool,
    /// Maximum-contrast borders, focus rings, tracks and muted text.
    pub high_contrast: bool,
}

impl A11yPreferences {
    /// Preferences from explicit values (a stored user setting).
    #[must_use]
    pub const fn new(reduce_motion: bool, high_contrast: bool) -> Self {
        Self {
            reduce_motion,
            high_contrast,
        }
    }

    /// Preferences from the process environment.
    #[must_use]
    pub fn from_env() -> Self {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Preferences from any lookup of named values (an environment, a config file, a test).
    #[must_use]
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Self {
        Self {
            reduce_motion: lookup(REDUCE_MOTION_VAR).is_some_and(|v| is_on(&v)),
            high_contrast: lookup(HIGH_CONTRAST_VAR).is_some_and(|v| is_on(&v)),
        }
    }

    /// Either preference wins: a stored setting and the environment are combined with this.
    #[must_use]
    pub const fn or(self, other: Self) -> Self {
        Self {
            reduce_motion: self.reduce_motion || other.reduce_motion,
            high_contrast: self.high_contrast || other.high_contrast,
        }
    }
}

fn is_on(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

/// Writes the preferences to the gallery window's `AedstA11y` global. A feature window does the
/// same two setter calls on the global it exports.
pub fn apply(window: &crate::gallery::Gallery, preferences: A11yPreferences) {
    use slint::ComponentHandle;
    let global = window.global::<crate::gallery::AedstA11y>();
    global.set_reduce_motion(preferences.reduce_motion);
    global.set_high_contrast(preferences.high_contrast);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lookup<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| {
            pairs
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).to_owned())
        }
    }

    #[test]
    fn nothing_set_means_normal_motion_and_contrast() {
        assert_eq!(
            A11yPreferences::from_lookup(lookup(&[])),
            A11yPreferences::default()
        );
    }

    #[test]
    fn truthy_words_turn_a_preference_on_in_any_case() {
        for word in ["1", "true", "TRUE", " yes ", "On"] {
            let prefs = A11yPreferences::from_lookup(lookup(&[(REDUCE_MOTION_VAR, word)]));
            assert!(prefs.reduce_motion, "{word:?}");
            assert!(!prefs.high_contrast);
        }
    }

    #[test]
    fn other_values_leave_it_off() {
        for word in ["", "0", "false", "no", "off", "2", "enable"] {
            let prefs = A11yPreferences::from_lookup(lookup(&[(HIGH_CONTRAST_VAR, word)]));
            assert!(!prefs.high_contrast, "{word:?}");
        }
    }

    #[test]
    fn either_source_turns_a_preference_on() {
        let stored = A11yPreferences::new(true, false);
        let env = A11yPreferences::new(false, true);
        assert_eq!(stored.or(env), A11yPreferences::new(true, true));
    }
}
