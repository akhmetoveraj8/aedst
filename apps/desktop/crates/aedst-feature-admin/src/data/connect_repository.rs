//! The Connect implementation of the repository: generated client + bearer token (+ idempotency key
//! on writes). Nothing is logged here: responses hold e-mail addresses and audit reasons.

use std::sync::Arc;

use aedst_api::{TokenSource, call_authenticated, with_idempotency_key};
use aedst_common::ErrorKind;
use aedst_contract::proto::aedst::admin::v1::{AdminServiceClient, GetOverviewRequest};
use connectrpc::client::{ClientConfig, HttpClient};
use futures::future::BoxFuture;

use super::mapping::{
    audit_from_wire, audit_request, broadcast_request, delete_request, overview_from_wire,
    tasks_from_wire, tasks_request,
};
use crate::domain::{
    AdminRepository, AdminTask, AuditEntry, BroadcastDraft, Overview, Page, PageRequest,
};

/// Talks to `AdminService`. A caller without the `admin` role gets `ErrorKind::Forbidden`.
pub struct ConnectAdminRepository {
    client: AdminServiceClient<HttpClient>,
    tokens: Arc<dyn TokenSource>,
    online: Arc<dyn Fn() -> bool + Send + Sync>,
}

impl ConnectAdminRepository {
    /// `online` reports connectivity so `unavailable` while offline is classified `Offline`.
    #[must_use]
    pub fn new(
        http: HttpClient,
        config: ClientConfig,
        tokens: Arc<dyn TokenSource>,
        online: impl Fn() -> bool + Send + Sync + 'static,
    ) -> Self {
        Self {
            client: AdminServiceClient::new(http, config),
            tokens,
            online: Arc::new(online),
        }
    }

    fn kind(&self, error: &aedst_api::ApiError) -> ErrorKind {
        error.kind((self.online)())
    }
}

impl AdminRepository for ConnectAdminRepository {
    fn overview(&self) -> BoxFuture<'_, Result<Overview, ErrorKind>> {
        Box::pin(async move {
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client
                    .get_overview_with_options(GetOverviewRequest::default(), options)
            })
            .await
            .map_err(|e| self.kind(&e))?;
            Ok(overview_from_wire(&response.into_owned()))
        })
    }

    fn list_tasks<'a>(
        &'a self,
        owner_id: Option<&'a str>,
        page: &'a PageRequest,
    ) -> BoxFuture<'a, Result<Page<AdminTask>, ErrorKind>> {
        Box::pin(async move {
            let request = tasks_request(owner_id, page);
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client
                    .list_tasks_with_options(request.clone(), options)
            })
            .await
            .map_err(|e| self.kind(&e))?;
            Ok(tasks_from_wire(&response.into_owned()))
        })
    }

    fn delete_task<'a>(
        &'a self,
        id: &'a str,
        reason: &'a str,
        key: &'a str,
    ) -> BoxFuture<'a, Result<(), ErrorKind>> {
        Box::pin(async move {
            let request = delete_request(id, reason);
            call_authenticated(self.tokens.as_ref(), |options| {
                self.client
                    .delete_task_with_options(request.clone(), with_idempotency_key(options, key))
            })
            .await
            .map_err(|e| self.kind(&e))?;
            Ok(())
        })
    }

    fn broadcast<'a>(
        &'a self,
        draft: &'a BroadcastDraft,
        key: &'a str,
    ) -> BoxFuture<'a, Result<u64, ErrorKind>> {
        Box::pin(async move {
            let request = broadcast_request(draft);
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client.broadcast_notification_with_options(
                    request.clone(),
                    with_idempotency_key(options, key),
                )
            })
            .await
            .map_err(|e| self.kind(&e))?;
            Ok(u64::try_from(response.into_owned().recipients).unwrap_or(0))
        })
    }

    fn list_audit_log<'a>(
        &'a self,
        page: &'a PageRequest,
    ) -> BoxFuture<'a, Result<Page<AuditEntry>, ErrorKind>> {
        Box::pin(async move {
            let request = audit_request(page);
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client
                    .list_audit_log_with_options(request.clone(), options)
            })
            .await
            .map_err(|e| self.kind(&e))?;
            Ok(audit_from_wire(&response.into_owned()))
        })
    }
}
