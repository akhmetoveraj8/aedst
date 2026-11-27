// The feature crates the shell composes, in sidebar order (`aedst-feature-<id>`). This file is the one
// list of them: `build.rs` includes it to merge the catalogs, `features.rs` checks its table against it.
// Kept free of inner attributes and doc comments so `include!` accepts it in both places.

/// Every composed feature, in sidebar order.
pub const FEATURE_IDS: [&str; 5] = ["tasks", "search", "notifications", "media", "admin"];
