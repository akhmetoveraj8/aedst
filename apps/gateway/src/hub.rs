//! The registry of live connections, keyed by owner id, and the fan-out into them.
//!
//! Each connection owns a bounded queue. `dispatch` never waits: a full queue means a slow client,
//! which is evicted (its receiver sees the queue close and the socket is closed with 4429) rather
//! than allowed to hold up the NATS consumer. Duplicates (JetStream redelivery) are dropped per
//! connection by event id. Two caps apply at registration: sockets per owner and sockets in total.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use thiserror::Error;
use tokio::sync::mpsc;

/// How many recent event ids a connection remembers for deduplication.
const SEEN_CAPACITY: usize = 1024;

/// A message for one connection.
#[derive(Debug, Clone)]
pub enum Outbound {
    /// A text frame: the event envelope exactly as published.
    Frame(Arc<str>),
    /// Close the socket with this code and reason.
    Close(u16, &'static str),
}

/// Registration refused.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum HubError {
    /// The user already has the maximum number of connections.
    #[error("too many connections for this user")]
    TooMany,
    /// This replica already holds the maximum number of connections.
    #[error("the gateway is at its connection limit")]
    Full,
}

/// A registered connection: the receiving half of its queue.
#[derive(Debug)]
pub struct Registration {
    /// Handle for [`Hub::unregister`].
    pub id: u64,
    /// Messages to write to the socket. `None` means the connection was evicted as too slow.
    pub rx: mpsc::Receiver<Outbound>,
}

struct Entry {
    id: u64,
    tx: mpsc::Sender<Outbound>,
    seen: Seen,
}

#[derive(Default)]
struct Seen {
    order: VecDeque<String>,
    set: HashSet<String>,
}

impl Seen {
    /// Returns false when `id` was already seen.
    fn insert(&mut self, id: &str) -> bool {
        if !self.set.insert(id.to_owned()) {
            return false;
        }
        self.order.push_back(id.to_owned());
        if self.order.len() > SEEN_CAPACITY
            && let Some(oldest) = self.order.pop_front()
        {
            self.set.remove(&oldest);
        }
        true
    }
}

type Connections = HashMap<String, Vec<Entry>>;

/// Live connections by owner id.
pub struct Hub {
    conns: Mutex<Connections>,
    next_id: AtomicU64,
    max_per_user: usize,
    max_total: usize,
    queue: usize,
}

impl Hub {
    /// Creates a hub allowing `max_per_user` connections per owner and `max_total` altogether,
    /// each with a queue of `queue` frames.
    #[must_use]
    pub fn new(max_per_user: usize, max_total: usize, queue: usize) -> Self {
        Self {
            conns: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            max_per_user,
            max_total,
            queue,
        }
    }

    fn lock(&self) -> MutexGuard<'_, Connections> {
        // A poisoned lock only means another task panicked; the map itself stays consistent.
        self.conns.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Registers a connection for `user`.
    ///
    /// # Errors
    /// [`HubError::Full`] when the replica is at its limit, [`HubError::TooMany`] when the user is.
    pub fn register(&self, user: &str) -> Result<Registration, HubError> {
        let mut conns = self.lock();
        if conns.values().map(Vec::len).sum::<usize>() >= self.max_total {
            return Err(HubError::Full);
        }
        let list = conns.entry(user.to_owned()).or_default();
        if list.len() >= self.max_per_user {
            return Err(HubError::TooMany);
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::channel(self.queue);
        list.push(Entry {
            id,
            tx,
            seen: Seen::default(),
        });
        Ok(Registration { id, rx })
    }

    /// Removes a connection (idempotent).
    pub fn unregister(&self, user: &str, id: u64) {
        let mut conns = self.lock();
        if let Some(list) = conns.get_mut(user) {
            list.retain(|e| e.id != id);
            if list.is_empty() {
                conns.remove(user);
            }
        }
    }

    /// Queues `frame` (event `event_id`) to every connection of `user`; returns how many accepted it.
    /// Slow connections are evicted.
    pub fn dispatch(&self, user: &str, event_id: &str, frame: &Arc<str>) -> usize {
        let mut conns = self.lock();
        let Some(list) = conns.get_mut(user) else {
            return 0;
        };
        let mut delivered = 0;
        list.retain_mut(|entry| {
            if !entry.seen.insert(event_id) {
                return true;
            }
            match entry.tx.try_send(Outbound::Frame(Arc::clone(frame))) {
                Ok(()) => {
                    delivered += 1;
                    true
                }
                // Full: too slow. Closed: the socket is already gone. Either way drop the entry.
                Err(_) => false,
            }
        });
        if list.is_empty() {
            conns.remove(user);
        }
        delivered
    }

    /// Asks every connection to close (graceful shutdown). A full queue is dropped, which closes it too.
    pub fn close_all(&self, code: u16, reason: &'static str) {
        let mut conns = self.lock();
        for entry in conns.values().flatten() {
            let _ = entry.tx.try_send(Outbound::Close(code, reason));
        }
        conns.clear();
    }

    /// Number of live connections.
    #[must_use]
    pub fn len(&self) -> usize {
        self.lock().values().map(Vec::len).sum()
    }

    /// True when no connection is registered.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(s: &str) -> Arc<str> {
        Arc::from(s)
    }

    #[tokio::test]
    async fn delivers_only_to_the_addressed_user_and_dedupes() {
        let hub = Hub::new(2, 16, 4);
        let mut a = hub.register("a").unwrap();
        let mut b = hub.register("b").unwrap();
        assert_eq!(hub.dispatch("a", "e1", &frame("one")), 1);
        assert_eq!(
            hub.dispatch("a", "e1", &frame("one")),
            0,
            "redelivery of the same event id"
        );
        assert!(matches!(a.rx.recv().await, Some(Outbound::Frame(f)) if &*f == "one"));
        assert!(b.rx.try_recv().is_err());
    }

    #[tokio::test]
    async fn per_user_limit_and_unregister() {
        let hub = Hub::new(1, 16, 4);
        let first = hub.register("a").unwrap();
        assert_eq!(hub.register("a").unwrap_err(), HubError::TooMany);
        hub.unregister("a", first.id);
        assert!(hub.register("a").is_ok());
    }

    #[tokio::test]
    async fn the_total_limit_spans_users() {
        let hub = Hub::new(2, 2, 4);
        let first = hub.register("a").unwrap();
        let _second = hub.register("b").unwrap();
        assert_eq!(hub.register("c").unwrap_err(), HubError::Full);
        hub.unregister("a", first.id);
        assert!(hub.register("c").is_ok());
    }

    #[tokio::test]
    async fn a_slow_connection_is_evicted_not_waited_for() {
        let hub = Hub::new(2, 16, 1);
        let mut slow = hub.register("a").unwrap();
        assert_eq!(hub.dispatch("a", "e1", &frame("1")), 1);
        assert_eq!(hub.dispatch("a", "e2", &frame("2")), 0, "queue of 1 is full");
        assert!(hub.is_empty());
        assert!(
            slow.rx.recv().await.is_some(),
            "the queued frame is still readable"
        );
        assert!(
            slow.rx.recv().await.is_none(),
            "then the queue reports the eviction"
        );
    }

    #[tokio::test]
    async fn close_all_sends_a_close_and_empties_the_hub() {
        let hub = Hub::new(2, 16, 4);
        let mut a = hub.register("a").unwrap();
        hub.close_all(1012, "restart");
        assert!(matches!(
            a.rx.recv().await,
            Some(Outbound::Close(1012, "restart"))
        ));
        assert!(hub.is_empty());
    }
}
