package com.aedst.core.capabilities

import com.aedst.core.testing.BehaviorFixture
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test

/** Replays `docs/contract/behavior/capabilities.json`, the cases every platform's resolver must agree on. */
class CapabilitiesReplayTest {
    private val fixture = BehaviorFixture.load("capabilities")
    private val clientBuild = fixture.getValue("clientBuild").jsonObject.let { build ->
        ClientBuild(
            platform = build.getValue("platform").jsonPrimitive.content,
            version = build.getValue("version").jsonPrimitive.content,
            features = build.strings("features"),
            flagged = build.strings("flagged"),
        )
    }

    @Test
    fun `every fixture case resolves as expected`() {
        val cases = fixture.getValue("cases").jsonArray.map { it.jsonObject }
        assertFalse(cases.isEmpty())
        for (case in cases) {
            // A failed fetch ("server": null) falls back to the last known answer, then to the defaults.
            val capabilities = (case["server"].asCapabilities() ?: case["lastKnown"].asCapabilities())
            val expected = case.getValue("expect").jsonObject
            for ((feature, shown) in expected) {
                assertEquals(
                    shown.jsonPrimitive.boolean,
                    CapabilityResolver.isEnabled(feature, clientBuild, capabilities),
                    "${case.getValue("id").jsonPrimitive.content}: $feature",
                )
            }
        }
    }

    private fun JsonObject.strings(key: String): Set<String> =
        (getValue(key) as JsonArray).map { it.jsonPrimitive.content }.toSet()

    private fun JsonElement?.asCapabilities(): ServerCapabilities? {
        if (this == null || this is JsonNull) return null
        val features = jsonObject.getValue("features").jsonObject.mapValues { (_, entry) ->
            ServerCapabilities.Feature(
                enabled = entry.jsonObject.getValue("enabled").jsonPrimitive.boolean,
                requiredClientVersion = entry.jsonObject["requiredClientVersion"]?.jsonPrimitive?.content,
            )
        }
        return ServerCapabilities(features)
    }
}
