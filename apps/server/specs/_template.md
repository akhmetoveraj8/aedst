# Spec: <module>/<feature>

Type: Command | Query
Module: <module>
Status: Draft | Approved | Implemented

## Context

<!-- Why this is needed, what problem it solves. -->

## Scenarios

**Happy path**

- Given ...
- When ...
- Then ...

**Edge cases**

- Given ...
- When ...
- Then ...

## Errors

| Condition | `sharederrors.Kind` | `connect.Code` |
| --------- | ------------------- | -------------- |
|           |                     |                |

## API

```proto
rpc <Method>(<Method>Request) returns (<Method>Response);
```

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |

## Events

| Event type | Version | partition_key | Payload | Consumers |
| ---------- | ------- | ------------- | ------- | --------- |

## Cross-module dependencies

<!-- A synchronous call to another module (through its api/), if any, and why it is not an event. -->

## NFR

- Idempotency: is an `Idempotency-Key` required?
- Timeout:
- Hot path: yes/no
