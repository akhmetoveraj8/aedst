//! Wire <-> domain. The only file that knows both the generated types and the domain model.

use aedst_contract::proto::aedst::notifications::v1 as wire;
use buffa::{EnumValue, MessageField};

use crate::domain::{
    Notification, NotificationKind, NotificationPage, NotificationQuery, PAGE_SIZE, Preferences,
};

/// Unknown or unspecified server values map to `Unknown`, never to a real kind.
#[must_use]
pub fn kind_from_wire(value: &EnumValue<wire::NotificationKind>) -> NotificationKind {
    match value {
        EnumValue::Known(wire::NotificationKind::NOTIFICATION_KIND_TASK_COMPLETED) => {
            NotificationKind::TaskCompleted
        }
        EnumValue::Known(wire::NotificationKind::NOTIFICATION_KIND_TASK_DUE_SOON) => {
            NotificationKind::TaskDueSoon
        }
        EnumValue::Known(wire::NotificationKind::NOTIFICATION_KIND_MEDIA_READY) => {
            NotificationKind::MediaReady
        }
        EnumValue::Known(wire::NotificationKind::NOTIFICATION_KIND_SYSTEM) => {
            NotificationKind::System
        }
        EnumValue::Known(wire::NotificationKind::NOTIFICATION_KIND_UNSPECIFIED)
        | EnumValue::Unknown(_) => NotificationKind::Unknown,
    }
}

/// A wire notification as the domain sees it. `read_at` unset means unread.
#[must_use]
pub fn notification_from_wire(item: &wire::Notification) -> Notification {
    Notification {
        id: item.id.clone(),
        kind: kind_from_wire(&item.kind),
        title: item.title.clone(),
        body: item.body.clone(),
        link: item.link.clone(),
        subject_id: item.subject_id.clone(),
        created_at: item.created_at.as_option().map_or(0, |t| t.seconds),
        read: item.read_at.as_option().is_some(),
    }
}

/// The list request: page size 20, the page token echoed back exactly.
#[must_use]
pub fn list_request(query: &NotificationQuery) -> wire::ListNotificationsRequest {
    wire::ListNotificationsRequest {
        unread_only: query.unread_only,
        page_size: i32::try_from(PAGE_SIZE).unwrap_or(20),
        page_token: query.page_token.clone().unwrap_or_default(),
        ..Default::default()
    }
}

/// A list response; an empty token means the last page.
#[must_use]
pub fn page_from_wire(response: &wire::ListNotificationsResponse) -> NotificationPage {
    NotificationPage {
        notifications: response
            .notifications
            .iter()
            .map(notification_from_wire)
            .collect(),
        next_page_token: Some(response.next_page_token.clone()).filter(|t| !t.is_empty()),
    }
}

/// The wire form of the switches.
#[must_use]
pub fn preferences_to_wire(preferences: &Preferences) -> wire::Preferences {
    wire::Preferences {
        push_enabled: preferences.push_enabled,
        task_completed: preferences.task_completed,
        task_due_soon: preferences.task_due_soon,
        media_ready: preferences.media_ready,
        ..Default::default()
    }
}

/// The switches from the wire.
#[must_use]
pub fn preferences_from_wire(preferences: &wire::Preferences) -> Preferences {
    Preferences {
        push_enabled: preferences.push_enabled,
        task_completed: preferences.task_completed,
        task_due_soon: preferences.task_due_soon,
        media_ready: preferences.media_ready,
    }
}

/// The update request. `preferences` is a required field of the contract, so it is always set.
#[must_use]
pub fn update_request(preferences: &Preferences) -> wire::UpdatePreferencesRequest {
    wire::UpdatePreferencesRequest {
        preferences: MessageField::some(preferences_to_wire(preferences)),
        ..Default::default()
    }
}

/// The unread count; a negative number (never sent by the server) is zero.
#[must_use]
pub fn unread_from_wire(unread: i32) -> u32 {
    u32::try_from(unread).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use buffa_types::google::protobuf::Timestamp;

    use super::*;

    #[test]
    fn unspecified_and_unknown_kinds_are_unknown_never_a_real_value() {
        assert_eq!(
            kind_from_wire(&EnumValue::Known(
                wire::NotificationKind::NOTIFICATION_KIND_UNSPECIFIED
            )),
            NotificationKind::Unknown
        );
        assert_eq!(
            kind_from_wire(&EnumValue::Unknown(42)),
            NotificationKind::Unknown
        );
        assert_eq!(
            kind_from_wire(&EnumValue::Known(
                wire::NotificationKind::NOTIFICATION_KIND_SYSTEM
            )),
            NotificationKind::System
        );
    }

    #[test]
    fn read_at_decides_the_read_flag_and_times_are_seconds() {
        let mut item = wire::Notification {
            id: "n1".into(),
            kind: EnumValue::Known(wire::NotificationKind::NOTIFICATION_KIND_MEDIA_READY),
            link: "/media/1".into(),
            ..Default::default()
        };
        assert!(!notification_from_wire(&item).read);
        item.created_at = MessageField::some(Timestamp {
            seconds: 1_000,
            nanos: 0,
            ..Default::default()
        });
        item.read_at = MessageField::some(Timestamp {
            seconds: 2_000,
            nanos: 0,
            ..Default::default()
        });
        let mapped = notification_from_wire(&item);
        assert_eq!(
            (
                mapped.read,
                mapped.created_at,
                mapped.kind,
                mapped.link.as_str()
            ),
            (true, 1_000, NotificationKind::MediaReady, "/media/1")
        );
    }

    #[test]
    fn the_list_request_echoes_the_token_and_asks_for_twenty() {
        let request = list_request(&NotificationQuery {
            unread_only: true,
            page_token: Some("tok".into()),
        });
        assert_eq!(
            (
                request.unread_only,
                request.page_size,
                request.page_token.as_str()
            ),
            (true, 20, "tok")
        );
        assert_eq!(list_request(&NotificationQuery::default()).page_token, "");
    }

    #[test]
    fn an_empty_next_token_means_the_last_page() {
        let response = wire::ListNotificationsResponse {
            next_page_token: String::new(),
            ..Default::default()
        };
        assert_eq!(page_from_wire(&response).next_page_token, None);
        let response = wire::ListNotificationsResponse {
            next_page_token: "n".into(),
            ..Default::default()
        };
        assert_eq!(
            page_from_wire(&response).next_page_token.as_deref(),
            Some("n")
        );
    }

    #[test]
    fn preferences_round_trip_and_the_update_request_sets_the_required_field() {
        let prefs = Preferences {
            push_enabled: true,
            task_completed: false,
            task_due_soon: true,
            media_ready: false,
        };
        assert_eq!(preferences_from_wire(&preferences_to_wire(&prefs)), prefs);
        let request = update_request(&prefs);
        assert_eq!(
            request.preferences.as_option().map(preferences_from_wire),
            Some(prefs)
        );
        assert_eq!(unread_from_wire(-3), 0);
        assert_eq!(unread_from_wire(7), 7);
    }
}
