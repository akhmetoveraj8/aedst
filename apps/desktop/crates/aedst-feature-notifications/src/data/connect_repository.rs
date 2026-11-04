//! The Connect implementation of the repository: generated client + bearer token + idempotency key.
//!
//! Push-device RPCs (`RegisterPushDevice`, Web Push) are deliberately absent: the desktop polls.

use std::sync::Arc;

use aedst_api::{TokenSource, call_authenticated, with_idempotency_key};
use aedst_common::ErrorKind;
use aedst_contract::proto::aedst::notifications::v1::{
    GetPreferencesRequest, GetUnreadCountRequest, MarkAllReadRequest, MarkReadRequest,
    NotificationsServiceClient,
};
use connectrpc::client::{ClientConfig, HttpClient};
use futures::future::BoxFuture;

use super::mapping::{
    list_request, page_from_wire, preferences_from_wire, unread_from_wire, update_request,
};
use crate::domain::{NotificationPage, NotificationQuery, NotificationsRepository, Preferences};

/// Talks to `NotificationsService`.
pub struct ConnectNotificationsRepository {
    client: NotificationsServiceClient<HttpClient>,
    tokens: Arc<dyn TokenSource>,
    online: Arc<dyn Fn() -> bool + Send + Sync>,
}

impl ConnectNotificationsRepository {
    /// `online` reports connectivity so `unavailable` while offline is classified `Offline`.
    #[must_use]
    pub fn new(
        http: HttpClient,
        config: ClientConfig,
        tokens: Arc<dyn TokenSource>,
        online: impl Fn() -> bool + Send + Sync + 'static,
    ) -> Self {
        Self {
            client: NotificationsServiceClient::new(http, config),
            tokens,
            online: Arc::new(online),
        }
    }

    fn kind(&self, error: &aedst_api::ApiError) -> ErrorKind {
        error.kind((self.online)())
    }
}

impl NotificationsRepository for ConnectNotificationsRepository {
    fn list<'a>(
        &'a self,
        query: &'a NotificationQuery,
    ) -> BoxFuture<'a, Result<NotificationPage, ErrorKind>> {
        Box::pin(async move {
            let request = list_request(query);
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client
                    .list_notifications_with_options(request.clone(), options)
            })
            .await
            .map_err(|e| self.kind(&e))?;
            Ok(page_from_wire(&response.into_owned()))
        })
    }

    fn unread_count(&self) -> BoxFuture<'_, Result<u32, ErrorKind>> {
        Box::pin(async move {
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client
                    .get_unread_count_with_options(GetUnreadCountRequest::default(), options)
            })
            .await
            .map_err(|e| self.kind(&e))?;
            Ok(unread_from_wire(response.into_owned().unread))
        })
    }

    fn mark_read<'a>(
        &'a self,
        ids: &'a [String],
        key: &'a str,
    ) -> BoxFuture<'a, Result<(), ErrorKind>> {
        Box::pin(async move {
            let request = MarkReadRequest {
                ids: ids.to_vec(),
                ..Default::default()
            };
            call_authenticated(self.tokens.as_ref(), |options| {
                self.client
                    .mark_read_with_options(request.clone(), with_idempotency_key(options, key))
            })
            .await
            .map_err(|e| self.kind(&e))?;
            Ok(())
        })
    }

    fn mark_all_read<'a>(&'a self, key: &'a str) -> BoxFuture<'a, Result<u32, ErrorKind>> {
        Box::pin(async move {
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client.mark_all_read_with_options(
                    MarkAllReadRequest::default(),
                    with_idempotency_key(options, key),
                )
            })
            .await
            .map_err(|e| self.kind(&e))?;
            Ok(unread_from_wire(response.into_owned().marked))
        })
    }

    fn get_preferences(&self) -> BoxFuture<'_, Result<Preferences, ErrorKind>> {
        Box::pin(async move {
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client
                    .get_preferences_with_options(GetPreferencesRequest::default(), options)
            })
            .await
            .map_err(|e| self.kind(&e))?;
            response
                .into_owned()
                .preferences
                .as_option()
                .map(preferences_from_wire)
                .ok_or(ErrorKind::Unknown)
        })
    }

    fn update_preferences<'a>(
        &'a self,
        preferences: &'a Preferences,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Preferences, ErrorKind>> {
        Box::pin(async move {
            let request = update_request(preferences);
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client.update_preferences_with_options(
                    request.clone(),
                    with_idempotency_key(options, key),
                )
            })
            .await
            .map_err(|e| self.kind(&e))?;
            Ok(response
                .into_owned()
                .preferences
                .as_option()
                .map_or(*preferences, preferences_from_wire))
        })
    }
}
