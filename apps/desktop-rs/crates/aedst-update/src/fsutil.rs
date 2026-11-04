//! Small-file persistence shared by the state stores: atomic replace and bounded, tolerant reads.

use std::fs;
use std::io::Write;
use std::path::Path;

/// A state file could not be written.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("cannot write the state file: {0}")]
pub struct StateError(pub String);

/// Largest state file that is read; anything bigger is treated as corrupt.
pub(crate) const MAX_STATE_BYTES: u64 = 4096;

/// Writes `bytes` to a sibling temporary file, flushes it to disk and renames it over `path`.
/// A crash leaves either the old file or the new one, never half of one.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), StateError> {
    let io = |e: std::io::Error| StateError(e.to_string());
    if let Some(parent) = path.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent).map_err(io)?;
    }
    let mut name = path
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".tmp");
    let temporary = path.with_file_name(name);
    let written = (|| {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&temporary);
        return Err(io(e));
    }
    Ok(())
}

/// The file's content, or `None` when it is missing, unreadable, empty or larger than [`MAX_STATE_BYTES`].
pub(crate) fn read_bounded(path: &Path) -> Option<Vec<u8>> {
    let length = fs::metadata(path).ok()?.len();
    if length == 0 || length > MAX_STATE_BYTES {
        return None;
    }
    fs::read(path).ok()
}
