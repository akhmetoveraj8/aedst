//! Test-run totals for `AedstAiTestResults` (the Rust port of web `countTests` in
//! `apps/web/shared/ui/ai-test-results.tsx`). The caller words the summary ("Ran 5 tests,
//! 1 failed") and passes the counts to the Slint `AedstAiTestCounts` struct.

/// The state of one test; mirrors the Slint enum `AedstAiTestStatus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TestStatus {
    /// The test passed.
    Passed,
    /// The test failed.
    Failed,
    /// The test was skipped.
    Skipped,
    /// The test is still running (counted in the total only).
    Running,
}

/// Totals of a test run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TestCounts {
    /// Every test, running ones included.
    pub total: u32,
    /// Passed tests.
    pub passed: u32,
    /// Failed tests.
    pub failed: u32,
    /// Skipped tests.
    pub skipped: u32,
}

/// Counts `statuses` by kind; running tests count only towards `total`.
#[must_use]
pub fn count_tests(statuses: impl IntoIterator<Item = TestStatus>) -> TestCounts {
    let mut counts = TestCounts::default();
    for status in statuses {
        counts.total += 1;
        match status {
            TestStatus::Passed => counts.passed += 1,
            TestStatus::Failed => counts.failed += 1,
            TestStatus::Skipped => counts.skipped += 1,
            TestStatus::Running => {}
        }
    }
    counts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_each_status_and_the_total() {
        let counts = count_tests([
            TestStatus::Passed,
            TestStatus::Passed,
            TestStatus::Failed,
            TestStatus::Skipped,
            TestStatus::Running,
        ]);
        assert_eq!(
            counts,
            TestCounts {
                total: 5,
                passed: 2,
                failed: 1,
                skipped: 1,
            }
        );
    }

    #[test]
    fn empty_run_is_all_zero() {
        assert_eq!(count_tests([]), TestCounts::default());
    }
}
