import type { MetaRecord } from "nextra";

const meta: MetaRecord = {
  "cross-cutting": "Cross-cutting decisions",
  server: "Server decisions",
  web: "Web decisions",
  android: "Android decisions",
  apple: "Apple decisions",
  desktop: "Desktop decisions",
  "---adr---": { type: "separator", title: "Server ADRs" },
  "0001-modular-monolith": "0001 — Modular monolith",
  "0002-connectrpc": "0002 — ConnectRPC",
  "0003-postgresql": "0003 — PostgreSQL",
  "0004-nats-jetstream": "0004 — NATS JetStream",
  "0005-river-for-jobs": "0005 — River for jobs",
  "0006-module-boundaries": "0006 — Module boundaries",
  "0007-merge-users-into-auth": "0007 — Merge users into auth",
  "0008-realtime-and-media-extraction": "0008 — Realtime and media extraction",
  "0009-api-compatibility-and-client-versioning": "0009 — API compatibility and client versioning",
  "0010-caching-and-data-partitioning": "0010 — Caching and data partitioning",
  "0011-outbox-relay-and-in-process-bus": "0011 — Outbox relay and in-process bus (superseded)",
  "0012-shared-platform-messaging-tables": "0012 — Shared platform messaging tables",
  "0013-android-offline-and-client-security": "0013 — Android offline and client security",
  "0014-river-insert-tx-as-outbox": "0014 — River InsertTx is the outbox",
  "0015-govips-and-imgproxy-media-pipeline": "0015 — govips and imgproxy media pipeline",
  "0016-device-attestation": "0016 — Device attestation (App Attest, Play Integrity)",
};

export default meta;
