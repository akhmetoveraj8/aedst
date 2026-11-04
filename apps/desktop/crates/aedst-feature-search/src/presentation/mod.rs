//! Presentation layer: the view model and the plain data the screen shows.

pub mod controller;
pub mod search_state;

pub use controller::{DEBOUNCE, SearchController};
pub use search_state::{HitRow, Phase, SearchView};
