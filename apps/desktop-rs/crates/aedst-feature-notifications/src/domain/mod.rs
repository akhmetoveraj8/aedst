//! Domain layer: pure model, ports and use cases. No wire types, no UI, no storage.

pub mod notification;
pub mod ports;
pub mod service;

pub use notification::{
    MAX_MARK_IDS, Notification, NotificationKind, NotificationPage, NotificationQuery, PAGE_SIZE,
    PreferenceKey, Preferences,
};
pub use ports::{LinkNavigator, NotificationsRepository};
pub use service::NotificationsService;
