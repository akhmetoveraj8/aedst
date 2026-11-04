//! All SQLite work, migrations included, runs on ONE dedicated thread; callers `await` the result.
//!
//! This is the only `std::thread` in the app (the old `DatabaseWorker` rule): a `Connection` is
//! not shared, and a slow query never blocks the UI or an async runtime thread. Not opened at all
//! when nothing needs it (OIDC mode keeps no tokens here).

use std::{
    path::Path,
    sync::{Arc, mpsc},
    thread::{self, JoinHandle, ThreadId},
};

use rusqlite::Connection;
use tokio::sync::oneshot;

use crate::{error::PersistenceError, migrations::migrate};

type Job = Box<dyn FnOnce(&mut Connection) + Send>;

struct Inner {
    jobs: Option<mpsc::Sender<Job>>,
    worker: Option<JoinHandle<()>>,
    worker_id: ThreadId,
}

impl Drop for Inner {
    fn drop(&mut self) {
        self.jobs.take(); // closes the channel: the worker drains and exits
        if let Some(worker) = self.worker.take() {
            // The last handle must not be dropped on the worker itself (it would join itself).
            if thread::current().id() != self.worker_id {
                let _ = worker.join();
            }
        }
    }
}

/// A handle to the database thread. Cheap to clone; the thread ends with the last clone.
#[derive(Clone)]
pub struct Database {
    inner: Arc<Inner>,
}

impl Database {
    /// Opens (creating if needed) the database at `path` and migrates it. Blocking: call it from
    /// `spawn_blocking` inside an async context.
    ///
    /// # Errors
    /// [`PersistenceError::TooNew`] for a newer file, [`PersistenceError::Open`]/`Sqlite` otherwise.
    pub fn open(path: &Path) -> Result<Self, PersistenceError> {
        let connection =
            Connection::open(path).map_err(|e| PersistenceError::Open(e.to_string()))?;
        Self::start(connection)
    }

    /// An in-memory database (tests, or sessions that deliberately keep nothing).
    ///
    /// # Errors
    /// SQLite errors while migrating.
    pub fn open_in_memory() -> Result<Self, PersistenceError> {
        Self::start(Connection::open_in_memory()?)
    }

    fn start(mut connection: Connection) -> Result<Self, PersistenceError> {
        // WAL for concurrent readers, secure_delete so removed rows (a signed-out user's outbox) are zeroed.
        connection.execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;
             PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;",
        )?;
        migrate(&mut connection)?;
        let (jobs, queue) = mpsc::channel::<Job>();
        let worker = thread::Builder::new()
            .name("aedst-db".into())
            .spawn(move || {
                let mut connection = connection;
                while let Ok(job) = queue.recv() {
                    job(&mut connection);
                }
            })
            .map_err(|e| PersistenceError::Open(e.to_string()))?;
        let worker_id = worker.thread().id();
        Ok(Self {
            inner: Arc::new(Inner {
                jobs: Some(jobs),
                worker: Some(worker),
                worker_id,
            }),
        })
    }

    /// Runs `work` on the database thread and returns its result.
    ///
    /// # Errors
    /// Whatever `work` returns, or [`PersistenceError::Closed`] when the thread is gone.
    pub async fn call<T, F>(&self, work: F) -> Result<T, PersistenceError>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> Result<T, PersistenceError> + Send + 'static,
    {
        let (reply, answer) = oneshot::channel();
        let job: Job = Box::new(move |connection| {
            let _ = reply.send(work(connection));
        });
        self.inner
            .jobs
            .as_ref()
            .ok_or(PersistenceError::Closed)?
            .send(job)
            .map_err(|_| PersistenceError::Closed)?;
        answer.await.map_err(|_| PersistenceError::Closed)?
    }

    /// Truncates the write-ahead log so deleted data does not linger in `-wal` (call on sign-out).
    ///
    /// # Errors
    /// SQLite errors.
    pub async fn checkpoint_truncate(&self) -> Result<(), PersistenceError> {
        self.call(|c| {
            c.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
                .map_err(Into::into)
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn work_runs_on_the_named_database_thread() {
        let db = Database::open_in_memory().unwrap();
        let name = db
            .call(|_| Ok(thread::current().name().map(str::to_owned)))
            .await
            .unwrap();
        assert_eq!(name.as_deref(), Some("aedst-db"));
    }

    #[tokio::test]
    async fn migrations_ran_and_secure_delete_is_on() {
        let db = Database::open_in_memory().unwrap();
        let (tables, secure): (i64, i64) = db
            .call(|c| {
                let tables = c.query_row(
                    "SELECT count(*) FROM sqlite_master WHERE name IN ('outbox','kv')",
                    [],
                    |r| r.get(0),
                )?;
                let secure = c.query_row("PRAGMA secure_delete", [], |r| r.get(0))?;
                Ok((tables, secure))
            })
            .await
            .unwrap();
        assert_eq!(tables, 2);
        assert_eq!(secure, 1);
    }

    #[tokio::test]
    async fn data_survives_reopening_a_file_and_a_newer_file_is_refused() {
        let dir = std::env::temp_dir().join(format!("aedst-persist-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("app.db");
        {
            let db = Database::open(&path).unwrap();
            db.call(|c| {
                Ok(c.execute(
                    "INSERT INTO kv (key, value, updated_at) VALUES ('k', x'01', 0)",
                    [],
                )?)
            })
            .await
            .unwrap();
        }
        let db = Database::open(&path).unwrap();
        let rows: i64 = db
            .call(|c| Ok(c.query_row("SELECT count(*) FROM kv", [], |r| r.get(0))?))
            .await
            .unwrap();
        assert_eq!(rows, 1);
        db.call(|c| Ok(c.execute_batch("PRAGMA user_version = 999")?))
            .await
            .unwrap();
        drop(db);
        assert!(matches!(
            Database::open(&path),
            Err(PersistenceError::TooNew { found: 999, .. })
        ));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn many_concurrent_callers_are_serialised() {
        let db = Database::open_in_memory().unwrap();
        let jobs: Vec<_> = (0..50)
            .map(|i| {
                let db = db.clone();
                tokio::spawn(async move {
                    db.call(move |c| {
                        Ok(c.execute(
                            "INSERT INTO outbox (id, type, payload) VALUES (?1, 't', x'00')",
                            [format!("id{i}")],
                        )?)
                    })
                    .await
                })
            })
            .collect();
        for job in jobs {
            job.await.unwrap().unwrap();
        }
        let n: i64 = db
            .call(|c| Ok(c.query_row("SELECT count(*) FROM outbox", [], |r| r.get(0))?))
            .await
            .unwrap();
        assert_eq!(n, 50);
    }
}
