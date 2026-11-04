//! The in-memory analytics transport used until the server has an ingest endpoint.
//!
//! Product analytics for every client must go through the project's own server (one consent point),
//! and `apps/server` has no analytics ingest RPC yet. Until it does, accepted events are held in a
//! bounded in-memory queue and never leave the process. The adapter that posts them to the server
//! will drain this queue (or replace it) behind the same [`EventTransport`] port.

use std::collections::VecDeque;
use std::sync::{Mutex, PoisonError};

use super::{EventTransport, OutgoingEvent};

/// How many events are kept; the oldest is dropped first.
pub const DEFAULT_CAPACITY: usize = 256;

/// A bounded, in-memory event queue. Nothing is sent anywhere.
#[derive(Debug)]
pub struct BufferedTransport {
    capacity: usize,
    events: Mutex<VecDeque<OutgoingEvent>>,
}

impl BufferedTransport {
    /// A queue that keeps at most `capacity` events (at least one).
    #[must_use]
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            events: Mutex::new(VecDeque::new()),
        }
    }

    /// Removes and returns everything queued, oldest first.
    pub fn drain(&self) -> Vec<OutgoingEvent> {
        self.events
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .drain(..)
            .collect()
    }

    /// Drops everything queued (consent withdrawn, sign-out).
    pub fn clear(&self) {
        self.events
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
    }

    /// How many events are queued.
    #[must_use]
    pub fn len(&self) -> usize {
        self.events
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len()
    }

    /// Whether nothing is queued.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl Default for BufferedTransport {
    fn default() -> Self {
        Self::new(DEFAULT_CAPACITY)
    }
}

impl EventTransport for BufferedTransport {
    fn send(&self, event: OutgoingEvent) {
        let mut queue = self.events.lock().unwrap_or_else(PoisonError::into_inner);
        if queue.len() >= self.capacity {
            queue.pop_front();
        }
        queue.push_back(event);
    }
}

#[cfg(test)]
mod tests {
    use serde_json::Map;

    use super::*;

    fn event(name: &str) -> OutgoingEvent {
        OutgoingEvent {
            name: name.to_owned(),
            distinct_id: "id".to_owned(),
            properties: Map::new(),
        }
    }

    #[test]
    fn keeps_the_newest_events_when_full() {
        let queue = BufferedTransport::new(2);
        queue.send(event("a"));
        queue.send(event("b"));
        queue.send(event("c"));
        let names: Vec<_> = queue.drain().into_iter().map(|e| e.name).collect();
        assert_eq!(names, ["b", "c"]);
        assert!(queue.is_empty());
    }

    #[test]
    fn clear_drops_everything() {
        let queue = BufferedTransport::default();
        queue.send(event("a"));
        queue.clear();
        assert_eq!(queue.len(), 0);
    }
}
