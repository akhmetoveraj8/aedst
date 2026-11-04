package com.aedst.core.testing

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/**
 * Loads a cross-platform behaviour fixture (`docs/contract/behavior/<name>.json`, the single source shared with
 * server, web, Apple and desktop). A module that replays fixtures adds that directory as a **test resources** source
 * directory in its `build.gradle.kts`; the file is never copied into the module.
 */
object BehaviorFixture {
    fun load(name: String): JsonObject {
        val stream = checkNotNull(BehaviorFixture::class.java.classLoader?.getResourceAsStream("$name.json")) {
            "Fixture $name.json is not on the test classpath: add docs/contract/behavior as a test resources srcDir"
        }
        val text = stream.use { it.readBytes().toString(Charsets.UTF_8) }
        return Json.parseToJsonElement(text) as JsonObject
    }
}
