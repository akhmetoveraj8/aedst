//! Adapters between the ports of the features and the shell's own services.

use std::sync::Arc;

use aedst_capabilities::CapabilitiesService;
use aedst_common::ErrorKind;
use aedst_feature_admin::domain::AdminAccess;
use aedst_feature_media::domain::{FilePicker, PickedFile};
use aedst_navigation::Router;
use futures::future::BoxFuture;

/// Opens an in-app link through the router; the router refuses anything outside the allow-list of
/// the active routes.
pub struct RouterLinks(pub Arc<Router>);

impl aedst_feature_search::domain::LinkNavigator for RouterLinks {
    fn open(&self, link: &str) -> bool {
        self.0.open_link(link)
    }
}

impl aedst_feature_notifications::domain::LinkNavigator for RouterLinks {
    fn open(&self, link: &str) -> bool {
        self.0.open_link(link)
    }
}

/// The Admin screen is offered when the server enables the `admin` capability. The server enforces
/// the role on every call; the role claim of the identity token is not read yet (phase 8 follow-up).
pub struct CapabilityAccess(pub Arc<CapabilitiesService>);

impl AdminAccess for CapabilityAccess {
    fn is_admin(&self) -> bool {
        self.0.is_enabled("admin")
    }
}

/// There is no native file dialog yet: picking is always cancelled, so uploads cannot start.
pub struct NoFilePicker;

impl FilePicker for NoFilePicker {
    fn pick(&self) -> BoxFuture<'_, Result<Option<PickedFile>, ErrorKind>> {
        Box::pin(async { Ok(None) })
    }
}
