//! Presentation layer: the view models and the plain data the screens show.

pub mod format;
pub mod inbox;
pub mod inbox_state;
pub mod preferences;
pub mod unread;

pub use inbox::InboxController;
pub use inbox_state::{InboxView, Phase, Row};
pub use preferences::{PreferencesController, PreferencesView, PrefsPhase};
pub use unread::{UnreadCounter, poll_delay};
