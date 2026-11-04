//! Proves the build-time generated contract is usable: clients construct, messages round-trip.

use aedst_contract::proto::aedst::tasks::v1::{CreateTaskRequest, TasksServiceClient};
use connectrpc::client::{ClientConfig, HttpClient};

type TestResult = Result<(), Box<dyn std::error::Error>>;

#[test]
fn tasks_client_constructs_without_network() -> TestResult {
    let config = ClientConfig::new("http://127.0.0.1:1".parse()?);
    let _client = TasksServiceClient::new(HttpClient::plaintext(), config);
    Ok(())
}

#[test]
fn message_round_trips_through_json() -> TestResult {
    let request = CreateTaskRequest {
        title: "купить молоко".into(),
        description: "مهمة جديدة".into(),
        ..Default::default()
    };
    let json = serde_json::to_string(&request)?;
    let back: CreateTaskRequest = serde_json::from_str(&json)?;
    assert_eq!(back.title, request.title);
    assert_eq!(back.description, request.description);
    Ok(())
}
