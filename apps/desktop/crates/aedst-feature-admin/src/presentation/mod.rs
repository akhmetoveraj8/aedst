//! Presentation layer: the view model and the plain data the screen shows.

pub mod controller;
pub mod state;
mod writes;

pub use controller::{AdminController, KeySource};
pub use state::{AdminView, BroadcastStatus, DeleteState, Phase, Section, Tab};
