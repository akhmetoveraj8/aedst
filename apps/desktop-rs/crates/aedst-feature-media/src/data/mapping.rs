//! Wire <-> domain. The only file that knows both the generated types and the domain model.

use aedst_contract::proto::aedst::media::v1 as wire;
use buffa::EnumValue;

use crate::domain::{
    FailureKind, Media, MediaKind, MediaPage, MediaQuery, MediaStatus, NewUpload, PAGE_SIZE,
    SecretUrl, UploadTarget, UploadTicket, Variant, VariantKind,
};

/// Unknown or unspecified server values map to `Unknown`, never to a real kind.
#[must_use]
pub fn kind_from_wire(value: &EnumValue<wire::MediaKind>) -> MediaKind {
    match value {
        EnumValue::Known(wire::MediaKind::MEDIA_KIND_IMAGE) => MediaKind::Image,
        EnumValue::Known(wire::MediaKind::MEDIA_KIND_VIDEO) => MediaKind::Video,
        EnumValue::Known(wire::MediaKind::MEDIA_KIND_AUDIO) => MediaKind::Audio,
        EnumValue::Known(wire::MediaKind::MEDIA_KIND_DOCUMENT) => MediaKind::Document,
        EnumValue::Known(wire::MediaKind::MEDIA_KIND_UNSPECIFIED) | EnumValue::Unknown(_) => {
            MediaKind::Unknown
        }
    }
}

/// The filter value for a kind; `Unknown` has none (it is never sent).
#[must_use]
pub fn kind_to_wire(kind: MediaKind) -> Option<EnumValue<wire::MediaKind>> {
    let known = match kind {
        MediaKind::Image => wire::MediaKind::MEDIA_KIND_IMAGE,
        MediaKind::Video => wire::MediaKind::MEDIA_KIND_VIDEO,
        MediaKind::Audio => wire::MediaKind::MEDIA_KIND_AUDIO,
        MediaKind::Document => wire::MediaKind::MEDIA_KIND_DOCUMENT,
        MediaKind::Unknown => return None,
    };
    Some(EnumValue::Known(known))
}

/// See [`kind_from_wire`].
#[must_use]
pub fn status_from_wire(value: &EnumValue<wire::MediaStatus>) -> MediaStatus {
    match value {
        EnumValue::Known(wire::MediaStatus::MEDIA_STATUS_PENDING_UPLOAD) => {
            MediaStatus::PendingUpload
        }
        EnumValue::Known(wire::MediaStatus::MEDIA_STATUS_PROCESSING) => MediaStatus::Processing,
        EnumValue::Known(wire::MediaStatus::MEDIA_STATUS_READY) => MediaStatus::Ready,
        EnumValue::Known(wire::MediaStatus::MEDIA_STATUS_FAILED) => MediaStatus::Failed,
        EnumValue::Known(wire::MediaStatus::MEDIA_STATUS_UNSPECIFIED) | EnumValue::Unknown(_) => {
            MediaStatus::Unknown
        }
    }
}

/// See [`kind_from_wire`]. Retired and unspecified values are `Unknown`.
#[must_use]
pub fn variant_kind_from_wire(value: &EnumValue<wire::VariantKind>) -> VariantKind {
    match value {
        EnumValue::Known(wire::VariantKind::VARIANT_KIND_POSTER) => VariantKind::Poster,
        EnumValue::Known(wire::VariantKind::VARIANT_KIND_THUMB_64) => VariantKind::Thumb64,
        EnumValue::Known(wire::VariantKind::VARIANT_KIND_AVATAR_256) => VariantKind::Avatar256,
        EnumValue::Known(wire::VariantKind::VARIANT_KIND_CARD_400) => VariantKind::Card400,
        EnumValue::Known(wire::VariantKind::VARIANT_KIND_FEED_800X600) => VariantKind::Feed800x600,
        EnumValue::Known(wire::VariantKind::VARIANT_KIND_STORY_1080X1350) => {
            VariantKind::Story1080x1350
        }
        EnumValue::Known(wire::VariantKind::VARIANT_KIND_UNSPECIFIED) | EnumValue::Unknown(_) => {
            VariantKind::Unknown
        }
    }
}

fn variant_from_wire(variant: &wire::Variant) -> Variant {
    Variant {
        kind: variant_kind_from_wire(&variant.kind),
        url: SecretUrl::new(variant.url.clone()),
        content_type: variant.content_type.clone(),
        width: variant.width,
        height: variant.height,
        size_bytes: variant.size_bytes,
    }
}

fn non_empty(text: &str) -> Option<String> {
    (!text.is_empty()).then(|| text.to_owned())
}

/// A wire media as the domain sees it.
#[must_use]
pub fn media_from_wire(media: &wire::Media) -> Media {
    let status = status_from_wire(&media.status);
    Media {
        id: media.id.clone(),
        kind: kind_from_wire(&media.kind),
        status,
        filename: media.filename.clone(),
        content_type: media.content_type.clone(),
        size_bytes: media.size_bytes,
        width: media.width,
        height: media.height,
        duration_ms: media.duration_ms,
        url: SecretUrl::new(media.url.clone()),
        variants: media.variants.iter().map(variant_from_wire).collect(),
        task_id: non_empty(&media.task_id),
        created_at: media.created_at.as_option().map_or(0, |t| t.seconds),
        failure: (status == MediaStatus::Failed)
            .then(|| FailureKind::from_reason(&media.failure_reason)),
    }
}

/// The list request. An absent filter or token stays empty; the token is echoed exactly.
#[must_use]
pub fn list_request(query: &MediaQuery) -> wire::ListMediaRequest {
    wire::ListMediaRequest {
        task_id: query.task_id.clone().unwrap_or_default(),
        kinds: query
            .kinds
            .iter()
            .filter_map(|k| kind_to_wire(*k))
            .collect(),
        page_size: PAGE_SIZE,
        page_token: query.page_token.clone().unwrap_or_default(),
        ..Default::default()
    }
}

/// A page; an empty token means "no more".
#[must_use]
pub fn page_from_wire(response: &wire::ListMediaResponse) -> MediaPage {
    MediaPage {
        items: response.media.iter().map(media_from_wire).collect(),
        next_page_token: non_empty(&response.next_page_token),
    }
}

/// The `CreateUpload` request. The size always fits `i64` for real files.
#[must_use]
pub fn create_request(new: &NewUpload) -> wire::CreateUploadRequest {
    wire::CreateUploadRequest {
        filename: new.filename.clone(),
        content_type: new.content_type.clone(),
        size_bytes: i64::try_from(new.size_bytes).unwrap_or(i64::MAX),
        task_id: new.task_id.clone().unwrap_or_default(),
        ..Default::default()
    }
}

/// The ticket of a `CreateUpload` response, or `None` when the server sent no media or no URL.
/// An empty method means `PUT`.
#[must_use]
pub fn ticket_from_wire(response: &wire::CreateUploadResponse) -> Option<UploadTicket> {
    let media = response.media.as_option().map(media_from_wire)?;
    if response.upload_url.is_empty() {
        return None;
    }
    let method = if response.method.is_empty() {
        "PUT".to_owned()
    } else {
        response.method.to_ascii_uppercase()
    };
    Some(UploadTicket {
        media,
        target: UploadTarget {
            url: SecretUrl::new(response.upload_url.clone()),
            method,
            headers: response
                .headers
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            expires_at: response.expires_at.as_option().map(|t| t.seconds),
        },
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use buffa::MessageField;
    use buffa_types::google::protobuf::Timestamp;

    use super::*;

    fn wire_media(status: wire::MediaStatus, reason: &str) -> wire::Media {
        wire::Media {
            id: "m1".into(),
            kind: EnumValue::Known(wire::MediaKind::MEDIA_KIND_IMAGE),
            status: EnumValue::Known(status),
            filename: "a.png".into(),
            url: "https://storage.example/o?sig=SECRET".into(),
            failure_reason: reason.into(),
            created_at: MessageField::some(Timestamp {
                seconds: 42,
                nanos: 0,
                ..Default::default()
            }),
            variants: vec![wire::Variant {
                kind: EnumValue::Known(wire::VariantKind::VARIANT_KIND_CARD_400),
                url: "https://x/c".into(),
                width: 400,
                height: 300,
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    #[test]
    fn unknown_and_unspecified_values_never_become_real_ones() {
        assert_eq!(kind_from_wire(&EnumValue::Unknown(99)), MediaKind::Unknown);
        assert_eq!(
            kind_from_wire(&EnumValue::Known(wire::MediaKind::MEDIA_KIND_UNSPECIFIED)),
            MediaKind::Unknown
        );
        assert_eq!(
            status_from_wire(&EnumValue::Unknown(7)),
            MediaStatus::Unknown
        );
        assert_eq!(
            variant_kind_from_wire(&EnumValue::Unknown(2)),
            VariantKind::Unknown
        );
        assert!(kind_to_wire(MediaKind::Unknown).is_none());
    }

    #[test]
    fn a_ready_media_maps_without_a_failure() {
        let media = media_from_wire(&wire_media(wire::MediaStatus::MEDIA_STATUS_READY, ""));
        assert_eq!(
            (media.status, media.failure, media.created_at, media.task_id),
            (MediaStatus::Ready, None, 42, None)
        );
        assert_eq!(media.variants[0].kind, VariantKind::Card400);
    }

    #[test]
    fn a_failed_media_carries_a_failure_kind_not_the_server_text() {
        let size = media_from_wire(&wire_media(
            wire::MediaStatus::MEDIA_STATUS_FAILED,
            "uploaded size does not match the declared size",
        ));
        let kind = media_from_wire(&wire_media(
            wire::MediaStatus::MEDIA_STATUS_FAILED,
            "file content does not match its declared type",
        ));
        let other = media_from_wire(&wire_media(wire::MediaStatus::MEDIA_STATUS_FAILED, ""));
        assert_eq!(size.failure, Some(FailureKind::SizeMismatch));
        assert_eq!(kind.failure, Some(FailureKind::TypeMismatch));
        assert_eq!(other.failure, Some(FailureKind::Unprocessable));
    }

    #[test]
    fn the_list_request_echoes_the_token_and_drops_unknown_kinds() {
        let request = list_request(&MediaQuery {
            task_id: Some("t".into()),
            kinds: vec![MediaKind::Image, MediaKind::Unknown],
            page_token: Some("tok==".into()),
        });
        assert_eq!(request.task_id, "t");
        assert_eq!(request.page_token, "tok==");
        assert_eq!(request.page_size, PAGE_SIZE);
        assert_eq!(request.kinds.len(), 1);
        let empty = list_request(&MediaQuery::default());
        assert_eq!(
            (empty.task_id.as_str(), empty.page_token.as_str()),
            ("", "")
        );
    }

    #[test]
    fn an_empty_next_token_means_the_end() {
        let page = page_from_wire(&wire::ListMediaResponse {
            media: vec![wire_media(wire::MediaStatus::MEDIA_STATUS_READY, "")],
            next_page_token: String::new(),
            ..Default::default()
        });
        assert_eq!((page.items.len(), page.next_page_token), (1, None));
    }

    #[test]
    fn a_ticket_needs_media_and_a_url_and_defaults_to_put() {
        let mut response = wire::CreateUploadResponse {
            media: MessageField::some(wire_media(
                wire::MediaStatus::MEDIA_STATUS_PENDING_UPLOAD,
                "",
            )),
            upload_url: "https://storage.example/o?sig=SECRET".into(),
            ..Default::default()
        };
        response.headers.insert("x-amz-meta".into(), "1".into());
        let ticket = ticket_from_wire(&response).unwrap();
        assert_eq!(ticket.target.method, "PUT");
        assert_eq!(
            ticket.target.headers,
            vec![("x-amz-meta".into(), "1".into())]
        );
        assert!(
            !format!("{ticket:?}").contains("SECRET"),
            "Debug hides the URL"
        );

        response.upload_url.clear();
        assert!(ticket_from_wire(&response).is_none());
    }

    #[test]
    fn the_create_request_carries_the_declared_values() {
        let request = create_request(&NewUpload {
            filename: "a.png".into(),
            content_type: "image/png".into(),
            size_bytes: 10,
            task_id: None,
        });
        assert_eq!((request.size_bytes, request.task_id.as_str()), (10, ""));
    }
}
