//! The Connect implementation of the repository: generated client + bearer token + idempotency key.

use std::sync::Arc;

use aedst_api::{TokenSource, call_authenticated, with_idempotency_key};
use aedst_common::ErrorKind;
use aedst_contract::proto::aedst::tasks::v1::{
    CompleteTaskRequest, ReopenTaskRequest, TasksServiceClient,
};
use connectrpc::client::{ClientConfig, HttpClient};
use futures::future::BoxFuture;

use super::mapping::{create_request, list_request, page_from_wire, task_from_wire};
use crate::domain::{NewTask, Task, TaskPage, TaskQuery, TaskRepository};

/// Talks to `TasksService`.
pub struct ConnectTaskRepository {
    client: TasksServiceClient<HttpClient>,
    tokens: Arc<dyn TokenSource>,
    online: Arc<dyn Fn() -> bool + Send + Sync>,
}

impl ConnectTaskRepository {
    /// `online` reports connectivity so `unavailable` while offline is classified `Offline`.
    #[must_use]
    pub fn new(
        http: HttpClient,
        config: ClientConfig,
        tokens: Arc<dyn TokenSource>,
        online: impl Fn() -> bool + Send + Sync + 'static,
    ) -> Self {
        Self {
            client: TasksServiceClient::new(http, config),
            tokens,
            online: Arc::new(online),
        }
    }

    fn kind(&self, error: &aedst_api::ApiError) -> ErrorKind {
        error.kind((self.online)())
    }
}

impl TaskRepository for ConnectTaskRepository {
    fn list<'a>(&'a self, query: &'a TaskQuery) -> BoxFuture<'a, Result<TaskPage, ErrorKind>> {
        Box::pin(async move {
            let request = list_request(query);
            let first = query.page_token.is_none();
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client
                    .list_tasks_with_options(request.clone(), options)
            })
            .await
            .map_err(|e| self.kind(&e))?;
            Ok(page_from_wire(&response.into_owned(), first))
        })
    }

    fn create<'a>(
        &'a self,
        new: &'a NewTask,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Task, ErrorKind>> {
        Box::pin(async move {
            let request = create_request(new);
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client
                    .create_task_with_options(request.clone(), with_idempotency_key(options, key))
            })
            .await
            .map_err(|e| self.kind(&e))?;
            response
                .into_owned()
                .task
                .as_option()
                .map(task_from_wire)
                .ok_or(ErrorKind::Unknown)
        })
    }

    fn set_done<'a>(
        &'a self,
        id: &'a str,
        done: bool,
        key: &'a str,
    ) -> BoxFuture<'a, Result<Task, ErrorKind>> {
        Box::pin(async move {
            let task = if done {
                let request = CompleteTaskRequest {
                    id: id.to_owned(),
                    ..Default::default()
                };
                let response = call_authenticated(self.tokens.as_ref(), |options| {
                    self.client.complete_task_with_options(
                        request.clone(),
                        with_idempotency_key(options, key),
                    )
                })
                .await
                .map_err(|e| self.kind(&e))?;
                response.into_owned().task.as_option().map(task_from_wire)
            } else {
                let request = ReopenTaskRequest {
                    id: id.to_owned(),
                    ..Default::default()
                };
                let response = call_authenticated(self.tokens.as_ref(), |options| {
                    self.client.reopen_task_with_options(
                        request.clone(),
                        with_idempotency_key(options, key),
                    )
                })
                .await
                .map_err(|e| self.kind(&e))?;
                response.into_owned().task.as_option().map(task_from_wire)
            };
            task.ok_or(ErrorKind::Unknown)
        })
    }
}
