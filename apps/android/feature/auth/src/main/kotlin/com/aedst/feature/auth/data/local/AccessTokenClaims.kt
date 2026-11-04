package com.aedst.feature.auth.data.local

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.util.Base64

/**
 * Reads claims from a JWT payload **for UI gating and bookkeeping only**: the role claim (show/hide the admin area)
 * and `sub` (the user id). The signature is deliberately not verified here: the client cannot verify it meaningfully
 * (AppAuth already validates the ID token's issuer, audience, expiry and nonce over TLS), and every protected RPC is
 * authorised by the server (`AEDST_ROLE_POLICY`), so a forged claim only reveals screens whose calls then fail with
 * PERMISSION_DENIED.
 *
 * Mirrors the server's `rolesFromToken`: [ROLES_CLAIM_PATHS] may be a top-level claim (`roles`; ZITADEL's
 * `urn:zitadel:iam:org:project:roles`) or a dotted path (Keycloak's `realm_access.roles`). The value may be an array of
 * strings, a space/comma-separated string, or — ZITADEL — an object keyed by role name (`{role: {orgId: domain}}`).
 */
internal object AccessTokenClaims {
    private val ROLES_CLAIM_PATHS = listOf("roles", "urn:zitadel:iam:org:project:roles", "realm_access.roles")
    private const val JWT_PARTS = 3

    fun roles(accessToken: String): Set<String> {
        val payload = payload(accessToken) ?: return emptySet()
        return ROLES_CLAIM_PATHS.asSequence()
            .mapNotNull { path -> payload.at(path) }
            .map(::rolesOf)
            .firstOrNull { it.isNotEmpty() }
            .orEmpty()
    }

    /** The `sub` claim of a JWT, or null if [token] is not a JWT or has none. */
    fun subject(token: String): String? =
        (payload(token)?.get("sub") as? JsonPrimitive)?.contentOrNull?.takeIf(String::isNotBlank)

    /** Whether [token] has the three-part shape of a JWT (ZITADEL issues opaque tokens unless the app says JWT). */
    fun isJwt(token: String): Boolean = payload(token) != null

    private fun payload(token: String): JsonObject? {
        val parts = token.split('.')
        if (parts.size != JWT_PARTS) return null
        return runCatching {
            val json = String(Base64.getUrlDecoder().decode(parts[1].trimEnd('=')), Charsets.UTF_8)
            Json.parseToJsonElement(json) as? JsonObject
        }.getOrNull()
    }

    private fun JsonObject.at(path: String): JsonElement? =
        // A claim name may itself contain dots only for the dotted-path form; try the exact key first.
        get(path) ?: path.split('.').fold(this as JsonElement?) { node, key -> (node as? JsonObject)?.get(key) }

    private fun rolesOf(element: JsonElement): Set<String> = when (element) {
        is JsonArray -> element.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.toSet()
        is JsonPrimitive -> element.contentOrNull.orEmpty().split(' ', ',').filter(String::isNotBlank).toSet()
        is JsonObject -> element.keys.filter(String::isNotBlank).toSet()
    }
}
