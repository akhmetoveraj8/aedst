//! The anonymous install id: a random UUID v4 kept in the consent store. It is never derived from
//! the user id, e-mail, machine name or hardware, and it is deleted when analytics is withdrawn.

use uuid::Uuid;

use crate::consent::{ConsentError, ConsentStore};

const KEY: &str = "telemetry.install_id";

/// Returns the stored id, creating and persisting a new one when absent or malformed.
///
/// # Errors
/// The store failed.
pub async fn load_or_create_install_id(store: &dyn ConsentStore) -> Result<String, ConsentError> {
    let stored = store.get(KEY).await?;
    let existing = stored
        .as_deref()
        .and_then(|bytes| std::str::from_utf8(bytes).ok())
        .and_then(|text| Uuid::parse_str(text).ok());
    if let Some(existing) = existing {
        return Ok(existing.to_string());
    }
    let fresh = Uuid::new_v4().to_string();
    store.set(KEY, fresh.as_bytes()).await?;
    Ok(fresh)
}

/// Deletes the stored id.
///
/// # Errors
/// The store failed.
pub async fn forget_install_id(store: &dyn ConsentStore) -> Result<(), ConsentError> {
    store.delete(KEY).await
}
