//! Hand-rolled `--flag value` parsing (no argument-parser crate is approved).

use std::collections::HashMap;

use crate::error::ReleaseError;

/// Parsed flags of one subcommand.
#[derive(Debug, Default)]
pub(crate) struct Flags {
    values: HashMap<String, String>,
    switches: Vec<String>,
}

impl Flags {
    /// Parses `args` (after the subcommand). `valued` flags take one value, `switches` take none.
    pub(crate) fn parse(
        args: &[String],
        valued: &[&str],
        switches: &[&str],
    ) -> Result<Self, ReleaseError> {
        let mut flags = Self::default();
        let mut iter = args.iter();
        while let Some(arg) = iter.next() {
            let name = arg
                .strip_prefix("--")
                .ok_or_else(|| ReleaseError::usage(format!("unexpected argument `{arg}`")))?;
            if switches.contains(&name) {
                if flags.switches.iter().any(|s| s == name) {
                    return Err(ReleaseError::usage(format!("--{name} given twice")));
                }
                flags.switches.push(name.to_owned());
            } else if valued.contains(&name) {
                let value = iter
                    .next()
                    .ok_or_else(|| ReleaseError::usage(format!("--{name} needs a value")))?;
                if flags
                    .values
                    .insert(name.to_owned(), value.clone())
                    .is_some()
                {
                    return Err(ReleaseError::usage(format!("--{name} given twice")));
                }
            } else {
                return Err(ReleaseError::usage(format!("unknown flag `--{name}`")));
            }
        }
        Ok(flags)
    }

    pub(crate) fn required(&self, name: &str) -> Result<&str, ReleaseError> {
        self.optional(name)
            .ok_or_else(|| ReleaseError::usage(format!("--{name} is required")))
    }

    pub(crate) fn optional(&self, name: &str) -> Option<&str> {
        self.values.get(name).map(String::as_str)
    }

    pub(crate) fn switch(&self, name: &str) -> bool {
        self.switches.iter().any(|s| s == name)
    }
}
