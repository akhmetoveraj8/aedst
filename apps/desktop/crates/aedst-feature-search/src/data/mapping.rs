//! Wire <-> domain. The only file that knows both the generated types and the domain model.

use aedst_contract::proto::aedst::search::v1 as wire;
use buffa::EnumValue;

use crate::domain::{DocumentKind, PAGE_SIZE, SearchHit, SearchPage, SearchQuery};

/// Unknown or unspecified server values map to `Unknown`, never to a real kind.
#[must_use]
pub fn kind_from_wire(value: &EnumValue<wire::DocumentKind>) -> DocumentKind {
    match value {
        EnumValue::Known(wire::DocumentKind::DOCUMENT_KIND_TASK) => DocumentKind::Task,
        EnumValue::Known(wire::DocumentKind::DOCUMENT_KIND_MEDIA) => DocumentKind::Media,
        EnumValue::Known(wire::DocumentKind::DOCUMENT_KIND_UNSPECIFIED) | EnumValue::Unknown(_) => {
            DocumentKind::Unknown
        }
    }
}

/// A wire hit as the domain sees it.
#[must_use]
pub fn hit_from_wire(hit: &wire::SearchHit) -> SearchHit {
    SearchHit {
        kind: kind_from_wire(&hit.kind),
        id: hit.id.clone(),
        title: hit.title.clone(),
        snippet: hit.snippet.clone(),
        score: hit.score,
        link: hit.link.clone(),
        updated_at: hit.updated_at.as_option().map(|t| t.seconds),
    }
}

/// The search request: every kind, page size 20, the text already normalised by the domain.
#[must_use]
pub fn search_request(query: &SearchQuery) -> wire::SearchRequest {
    wire::SearchRequest {
        query: query.text.clone(),
        page_size: i32::try_from(PAGE_SIZE).unwrap_or(20),
        page_token: query.page_token.clone().unwrap_or_default(),
        ..Default::default()
    }
}

/// The suggest request.
#[must_use]
pub fn suggest_request(prefix: &str, limit: u32) -> wire::SuggestRequest {
    wire::SuggestRequest {
        prefix: prefix.to_owned(),
        limit: i32::try_from(limit).unwrap_or(8),
        ..Default::default()
    }
}

/// A search response. `total_estimate` is meaningful on the first page only, and the next-page
/// token is kept exactly as received (an empty one means the last page).
#[must_use]
pub fn page_from_wire(response: &wire::SearchResponse, first_page: bool) -> SearchPage {
    SearchPage {
        hits: response.hits.iter().map(hit_from_wire).collect(),
        next_page_token: Some(response.next_page_token.clone()).filter(|t| !t.is_empty()),
        total_estimate: first_page.then(|| u32::try_from(response.total_estimate).unwrap_or(0)),
    }
}

#[cfg(test)]
mod tests {
    use buffa::MessageField;
    use buffa_types::google::protobuf::Timestamp;

    use super::*;

    #[test]
    fn unspecified_and_unknown_kinds_are_unknown_never_a_real_value() {
        assert_eq!(
            kind_from_wire(&EnumValue::Known(
                wire::DocumentKind::DOCUMENT_KIND_UNSPECIFIED
            )),
            DocumentKind::Unknown
        );
        assert_eq!(
            kind_from_wire(&EnumValue::Unknown(42)),
            DocumentKind::Unknown
        );
        assert_eq!(
            kind_from_wire(&EnumValue::Known(wire::DocumentKind::DOCUMENT_KIND_MEDIA)),
            DocumentKind::Media
        );
    }

    #[test]
    fn a_hit_maps_with_and_without_a_timestamp() {
        let mut hit = wire::SearchHit {
            kind: EnumValue::Known(wire::DocumentKind::DOCUMENT_KIND_TASK),
            id: "a".into(),
            title: "t".into(),
            snippet: "s".into(),
            score: 0.5,
            link: "/tasks/a".into(),
            ..Default::default()
        };
        assert_eq!(hit_from_wire(&hit).updated_at, None);
        hit.updated_at = MessageField::some(Timestamp {
            seconds: 86_400,
            nanos: 0,
            ..Default::default()
        });
        let mapped = hit_from_wire(&hit);
        assert_eq!(
            (mapped.kind, mapped.updated_at, mapped.link.as_str()),
            (DocumentKind::Task, Some(86_400), "/tasks/a")
        );
    }

    #[test]
    fn the_requests_use_the_spec_defaults_and_echo_the_token() {
        let request = search_request(&SearchQuery {
            text: "milk".into(),
            page_token: Some("tok".into()),
        });
        assert_eq!(request.query, "milk");
        assert_eq!(request.page_size, 20);
        assert_eq!(request.page_token, "tok");
        assert!(request.kinds.is_empty(), "empty means every kind");
        let first = search_request(&SearchQuery {
            text: "milk".into(),
            page_token: None,
        });
        assert_eq!(first.page_token, "");
        let suggest = suggest_request("mi", 8);
        assert_eq!((suggest.prefix.as_str(), suggest.limit), ("mi", 8));
    }

    #[test]
    fn the_estimate_only_comes_from_the_first_page_and_an_empty_token_means_last() {
        let response = wire::SearchResponse {
            total_estimate: 41,
            next_page_token: String::new(),
            ..Default::default()
        };
        assert_eq!(page_from_wire(&response, true).total_estimate, Some(41));
        assert_eq!(page_from_wire(&response, false).total_estimate, None);
        assert_eq!(page_from_wire(&response, true).next_page_token, None);
        let more = wire::SearchResponse {
            next_page_token: "n".into(),
            ..Default::default()
        };
        assert_eq!(
            page_from_wire(&more, true).next_page_token.as_deref(),
            Some("n")
        );
    }
}
