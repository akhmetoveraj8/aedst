//! Presentation layer: the view models and the plain data the screens show.

pub mod controller;
pub mod list_state;
pub mod viewer;

pub use controller::LibraryController;
pub use list_state::{LibraryView, Phase, Row, UploadView};
pub use viewer::{
    DecodeError, DecodedImage, MAX_DISPLAY_EDGE, MAX_DOWNLOAD_BYTES, MAX_PIXELS, ViewerController,
    ViewerPhase, ViewerView, decode,
};
