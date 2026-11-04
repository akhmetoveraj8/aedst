//! Presentation layer: the view model and the plain data the screen shows.

pub mod controller;
pub mod list_state;

pub use controller::TaskListController;
pub use list_state::{CreateStatus, ListView, Phase, Row};
