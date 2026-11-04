package com.aedst.feature.auth.domain.model

/**
 * What the server concluded about this device (Play Integrity). Informational only: nothing in the app gates on it
 * yet (apps/server/docs/adr/0002-play-integrity-verification.md, enforcement is a follow-up).
 *
 * [reason] and [deviceVerdict] are short lowercase labels (e.g. `device_not_trusted`, `meets_device_integrity`), safe
 * for telemetry; `""` when not applicable.
 */
data class DeviceAttestation(val verified: Boolean, val reason: String, val deviceVerdict: String)
