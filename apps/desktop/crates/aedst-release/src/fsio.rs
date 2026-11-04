//! File helpers: bounded reads and create-new writes (nothing is ever overwritten).

use std::io::{Read, Write};
use std::path::Path;

use crate::error::ReleaseError;

/// Reads a text file of at most `limit` bytes.
pub(crate) fn read_text(path: &Path, limit: u64) -> Result<String, ReleaseError> {
    let file = std::fs::File::open(path).map_err(|e| ReleaseError::io("cannot read", path, e))?;
    let mut text = String::new();
    file.take(limit + 1)
        .read_to_string(&mut text)
        .map_err(|e| ReleaseError::io("cannot read", path, e))?;
    if text.len() as u64 > limit {
        return Err(ReleaseError::usage(format!(
            "{} is larger than {limit} bytes",
            path.display()
        )));
    }
    Ok(text)
}

/// Creates `path` (it must not exist) and writes `bytes`. `private` = mode 0600 on Unix.
pub(crate) fn create_new(path: &Path, bytes: &[u8], private: bool) -> Result<(), ReleaseError> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    if private {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    #[cfg(not(unix))]
    let _ = private;
    let mut file = options.open(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            ReleaseError::usage(format!(
                "{} already exists; refusing to overwrite",
                path.display()
            ))
        } else {
            ReleaseError::io("cannot create", path, e)
        }
    })?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| ReleaseError::io("cannot write", path, e))
}
