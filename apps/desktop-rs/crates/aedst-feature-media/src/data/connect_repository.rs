//! The Connect implementation of the repository: generated client + bearer token + idempotency key.
//!
//! Writes carry one `Idempotency-Key` per call; the key is made before the call, so the one
//! replay after a token refresh reuses it. Nothing is queued offline.

use std::sync::Arc;

use aedst_api::{TokenSource, call_authenticated, with_idempotency_key};
use aedst_common::ErrorKind;
use aedst_contract::proto::aedst::media::v1::{
    CompleteUploadRequest, DeleteMediaRequest, GetMediaRequest, MediaServiceClient,
};
use connectrpc::client::{ClientConfig, HttpClient};
use futures::future::BoxFuture;

use super::mapping::{
    create_request, list_request, media_from_wire, page_from_wire, ticket_from_wire,
};
use crate::domain::{Media, MediaPage, MediaQuery, MediaRepository, NewUpload, UploadTicket};

/// Talks to `MediaService`.
pub struct ConnectMediaRepository {
    client: MediaServiceClient<HttpClient>,
    tokens: Arc<dyn TokenSource>,
    online: Arc<dyn Fn() -> bool + Send + Sync>,
}

impl ConnectMediaRepository {
    /// `online` reports connectivity so `unavailable` while offline is classified `Offline`.
    #[must_use]
    pub fn new(
        http: HttpClient,
        config: ClientConfig,
        tokens: Arc<dyn TokenSource>,
        online: impl Fn() -> bool + Send + Sync + 'static,
    ) -> Self {
        Self {
            client: MediaServiceClient::new(http, config),
            tokens,
            online: Arc::new(online),
        }
    }

    fn kind(&self, error: &aedst_api::ApiError) -> ErrorKind {
        error.kind((self.online)())
    }
}

fn new_key() -> String {
    uuid::Uuid::new_v4().to_string()
}

impl MediaRepository for ConnectMediaRepository {
    fn list<'a>(&'a self, query: &'a MediaQuery) -> BoxFuture<'a, Result<MediaPage, ErrorKind>> {
        Box::pin(async move {
            let request = list_request(query);
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client
                    .list_media_with_options(request.clone(), options)
            })
            .await
            .map_err(|e| self.kind(&e))?;
            Ok(page_from_wire(&response.into_owned()))
        })
    }

    fn get<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<Media, ErrorKind>> {
        Box::pin(async move {
            let request = GetMediaRequest {
                id: id.to_owned(),
                ..Default::default()
            };
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client.get_media_with_options(request.clone(), options)
            })
            .await
            .map_err(|e| self.kind(&e))?;
            response
                .into_owned()
                .media
                .as_option()
                .map(media_from_wire)
                .ok_or(ErrorKind::Unknown)
        })
    }

    fn create_upload<'a>(
        &'a self,
        new: &'a NewUpload,
    ) -> BoxFuture<'a, Result<UploadTicket, ErrorKind>> {
        Box::pin(async move {
            let request = create_request(new);
            let key = new_key();
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client.create_upload_with_options(
                    request.clone(),
                    with_idempotency_key(options, &key),
                )
            })
            .await
            .map_err(|e| self.kind(&e))?;
            ticket_from_wire(&response.into_owned()).ok_or(ErrorKind::Unknown)
        })
    }

    fn complete_upload<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<Media, ErrorKind>> {
        Box::pin(async move {
            let request = CompleteUploadRequest {
                id: id.to_owned(),
                ..Default::default()
            };
            let key = new_key();
            let response = call_authenticated(self.tokens.as_ref(), |options| {
                self.client.complete_upload_with_options(
                    request.clone(),
                    with_idempotency_key(options, &key),
                )
            })
            .await
            .map_err(|e| self.kind(&e))?;
            response
                .into_owned()
                .media
                .as_option()
                .map(media_from_wire)
                .ok_or(ErrorKind::Unknown)
        })
    }

    fn delete<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<(), ErrorKind>> {
        Box::pin(async move {
            let request = DeleteMediaRequest {
                id: id.to_owned(),
                ..Default::default()
            };
            let key = new_key();
            call_authenticated(self.tokens.as_ref(), |options| {
                self.client
                    .delete_media_with_options(request.clone(), with_idempotency_key(options, &key))
            })
            .await
            .map_err(|e| self.kind(&e))?;
            Ok(())
        })
    }
}
