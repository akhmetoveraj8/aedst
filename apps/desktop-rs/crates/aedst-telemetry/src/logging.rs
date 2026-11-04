//! `tracing` setup: JSON lines in a daily rolling file, an env filter and a redacting writer.
//!
//! Every line passes through [`crate::scrub`] before it reaches the file, so a token, an e-mail or
//! a presigned URL that slipped into a log call (or into a dependency's log line) never lands on
//! disk. Nothing is printed to the console. The log is never uploaded by the app: the user attaches it.

use std::io::{self, Write};
use std::path::PathBuf;

use tracing_appender::non_blocking::{NonBlocking, WorkerGuard};
use tracing_appender::rolling::{InitError, RollingFileAppender, Rotation};
use tracing_subscriber::EnvFilter;
use tracing_subscriber::fmt::MakeWriter;

use crate::scrub::{scrub_json, scrub_pii};

/// Environment variable that overrides the filter (`RUST_LOG` syntax).
pub const FILTER_ENV: &str = "AEDST_LOG";

/// Where and how to log.
#[derive(Clone, Debug)]
pub struct LoggingConfig {
    /// Directory of the log files (created when missing).
    pub directory: PathBuf,
    /// File name prefix: `<prefix>.<date>.log`.
    pub file_prefix: String,
    /// Filter used when `AEDST_LOG` is unset or invalid.
    pub default_filter: String,
    /// Daily files kept before the oldest is removed.
    pub max_files: usize,
}

impl LoggingConfig {
    /// `info` into `directory`, keeping 14 days.
    #[must_use]
    pub fn new(directory: impl Into<PathBuf>) -> Self {
        Self {
            directory: directory.into(),
            file_prefix: "aedst".to_owned(),
            default_filter: "info".to_owned(),
            max_files: 14,
        }
    }
}

/// Logging could not be started.
#[derive(Debug, thiserror::Error)]
pub enum LoggingError {
    /// The log directory or file could not be created.
    #[error("cannot open the log file: {0}")]
    File(#[from] InitError),
    /// The default filter is not valid.
    #[error("invalid log filter: {0}")]
    Filter(String),
    /// A global subscriber is already installed.
    #[error("a global tracing subscriber is already installed")]
    AlreadyInstalled,
}

/// Keeps the background writer alive; drop it at exit to flush the last lines.
pub struct LogGuard {
    _worker: WorkerGuard,
}

/// Installs the global subscriber.
///
/// # Errors
/// The file cannot be created, the filter is invalid, or a subscriber is already installed.
pub fn init_logging(config: &LoggingConfig) -> Result<LogGuard, LoggingError> {
    let (subscriber, guard) = build_subscriber(config)?;
    tracing::subscriber::set_global_default(subscriber)
        .map_err(|_| LoggingError::AlreadyInstalled)?;
    Ok(guard)
}

/// Builds the subscriber without installing it (tests use `tracing::subscriber::with_default`).
///
/// # Errors
/// The file cannot be created or the default filter is invalid.
pub fn build_subscriber(
    config: &LoggingConfig,
) -> Result<(impl tracing::Subscriber + Send + Sync, LogGuard), LoggingError> {
    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix(&config.file_prefix)
        .filename_suffix("log")
        .max_log_files(config.max_files)
        .build(&config.directory)?;
    let (writer, worker) = tracing_appender::non_blocking(appender);
    let filter = match EnvFilter::try_from_env(FILTER_ENV) {
        Ok(filter) => filter,
        Err(_) => EnvFilter::try_new(&config.default_filter)
            .map_err(|error| LoggingError::Filter(error.to_string()))?,
    };
    let subscriber = tracing_subscriber::fmt()
        .json()
        .with_ansi(false)
        .with_env_filter(filter)
        .with_writer(Redacting::new(writer))
        .finish();
    Ok((subscriber, LogGuard { _worker: worker }))
}

/// A [`MakeWriter`] whose writers scrub each line before passing it on.
#[derive(Clone)]
pub struct Redacting<M = NonBlocking> {
    inner: M,
}

impl<M> Redacting<M> {
    /// Wraps `inner`.
    #[must_use]
    pub fn new(inner: M) -> Self {
        Self { inner }
    }
}

impl<'a, M: MakeWriter<'a>> MakeWriter<'a> for Redacting<M> {
    type Writer = RedactingWriter<M::Writer>;

    fn make_writer(&'a self) -> Self::Writer {
        RedactingWriter {
            inner: self.inner.make_writer(),
            pending: Vec::new(),
        }
    }
}

/// Buffers until a newline, then writes the scrubbed line.
pub struct RedactingWriter<W: Write> {
    inner: W,
    pending: Vec<u8>,
}

impl<W: Write> RedactingWriter<W> {
    fn emit(&mut self, line: &[u8]) -> io::Result<()> {
        let mut scrubbed = redact_line(line);
        scrubbed.push(b'\n');
        self.inner.write_all(&scrubbed)
    }
}

/// A JSON line is scrubbed value by value; anything else as plain text.
fn redact_line(line: &[u8]) -> Vec<u8> {
    match serde_json::from_slice::<serde_json::Value>(line) {
        Ok(mut value) => {
            scrub_json(&mut value);
            serde_json::to_vec(&value).unwrap_or_else(|_| b"{}".to_vec())
        }
        Err(_) => scrub_pii(&String::from_utf8_lossy(line)).into_bytes(),
    }
}

impl<W: Write> Write for RedactingWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.pending.extend_from_slice(buf);
        while let Some(newline) = self.pending.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=newline).collect();
            self.emit(&line[..newline])?;
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

impl<W: Write> Drop for RedactingWriter<W> {
    fn drop(&mut self) {
        if !self.pending.is_empty() {
            let rest = std::mem::take(&mut self.pending);
            // Nothing sensible to do with a write error while dropping.
            let _ = self.emit(&rest);
        }
    }
}
