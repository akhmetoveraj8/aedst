//! Time text for rows. A fixed numeric form (`2026-11-01 09:30`, UTC) needs no translation and
//! reads the same in every locale; the workspace has no approved runtime date library (`chrono`
//! is test-only), and this is the whole need.

/// Formats Unix seconds as `YYYY-MM-DD HH:MM` (UTC). Zero or negative (unset) is empty.
#[must_use]
pub fn format_time(seconds: i64) -> String {
    if seconds <= 0 {
        return String::new();
    }
    let days = seconds.div_euclid(86_400);
    let rest = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}",
        rest / 3_600,
        rest % 3_600 / 60
    )
}

/// Days since 1970-01-01 to a proleptic Gregorian date (Howard Hinnant's `civil_from_days`).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::format_time;

    #[test]
    fn formats_known_instants_in_utc() {
        assert_eq!(format_time(1), "1970-01-01 00:00");
        assert_eq!(
            format_time(951_782_400 + 3_600 * 13 + 60 * 7),
            "2000-02-29 13:07"
        );
        assert_eq!(format_time(1_793_525_400), "2026-11-01 09:30");
    }

    #[test]
    fn unset_is_empty() {
        assert_eq!(format_time(0), "");
        assert_eq!(format_time(-5), "");
    }
}
