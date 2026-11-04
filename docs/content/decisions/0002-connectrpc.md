---
title: "ADR-0002: ConnectRPC + Protobuf as the API contract"
description: "Accepted"
---

# ADR-0002: ConnectRPC + Protobuf as the API contract

## Status
Accepted

## Context
Four client platforms (Web, Android, Apple, Desktop) need a shared, versioned API
contract that doesn't drift between clients, and the same contract must work
unchanged when a module moves from an in-process call to a network call during
service extraction.

## Decision
Define all APIs contract-first in Protobuf under `api/proto/`, managed with
Buf (lint + breaking-change detection in CI). Serve them with ConnectRPC, which
speaks Connect's own protocol (plain HTTP/1.1 + JSON, browser- and curl-
friendly), gRPC, and gRPC-Web from the same handler — so Web can call the API
without a gRPC-Web proxy while Android/iOS/Desktop use gRPC natively. Plain REST
is added only where a concrete external interoperability need exists (e.g. a
public webhook receiver), not as a default alongside every RPC.

## Consequences
- One `.proto` per module's public API is both the Go interface (via
  `buf generate`) and the wire contract for every client and for inter-module
  RPC after extraction.
- `buf breaking` in CI prevents accidental contract breaks; new fields/methods
  are additive, breaking changes require a new `v2` package.
- Validation is declared on the proto messages (protovalidate/CEL) instead of
  hand-written per-handler checks, so client and server agree on constraints
  without a second codegen step.
- No REST-vs-RPC duplication to maintain for the common case.
