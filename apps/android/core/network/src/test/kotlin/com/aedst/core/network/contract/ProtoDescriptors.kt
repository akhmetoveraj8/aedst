package com.aedst.core.network.contract

import com.connectrpc.StreamType
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import java.io.File

/** One RPC as declared in the `.proto` files. */
data class RpcDescriptor(
    val protoPackage: String,
    val service: String,
    val method: String,
    /** Fully qualified message names with a leading dot, e.g. `.aedst.auth.v1.LoginRequest`. */
    val inputType: String,
    val outputType: String,
    val streamType: StreamType,
) {
    /** The Connect wire path, e.g. `aedst.auth.v1.AuthService/Login`. */
    val path: String get() = "$protoPackage.$service/$method"
}

/** A service and its RPCs. */
data class ServiceDescriptor(val protoPackage: String, val name: String, val rpcs: List<RpcDescriptor>)

/**
 * Reads the JSON `FileDescriptorSet` that `make descriptors` (`buf build ... -o descriptors.json`) writes. A plain
 * kotlinx.serialization JSON tree is enough: the test only needs service / method / type names and streaming flags,
 * and protobuf-javalite (what the app links) carries no descriptors.
 */
object ProtoDescriptors {

    fun load(file: File): List<ServiceDescriptor> {
        val root = Json.parseToJsonElement(file.readText()).jsonObject
        return root.array("file").flatMap { fileElement ->
            val protoFile = fileElement.jsonObject
            val protoPackage = protoFile.string("package").orEmpty()
            protoFile.array("service").map { parseService(protoPackage, it.jsonObject) }
        }
    }

    private fun parseService(protoPackage: String, service: JsonObject): ServiceDescriptor {
        val serviceName = service.string("name").orEmpty()
        val rpcs = service.array("method").map { element ->
            val method = element.jsonObject
            RpcDescriptor(
                protoPackage = protoPackage,
                service = serviceName,
                method = method.string("name").orEmpty(),
                inputType = method.string("inputType", "input_type").orEmpty(),
                outputType = method.string("outputType", "output_type").orEmpty(),
                streamType = streamType(
                    client = method.flag("clientStreaming", "client_streaming"),
                    server = method.flag("serverStreaming", "server_streaming"),
                ),
            )
        }
        return ServiceDescriptor(protoPackage, serviceName, rpcs)
    }

    private fun streamType(client: Boolean, server: Boolean): StreamType = when {
        client && server -> StreamType.BIDI
        client -> StreamType.CLIENT
        server -> StreamType.SERVER
        else -> StreamType.UNARY
    }

    /** protojson uses lowerCamelCase; accept the original snake_case spelling too. */
    private fun JsonObject.string(vararg keys: String): String? =
        keys.firstNotNullOfOrNull { (this[it] as? JsonPrimitive)?.contentOrNull }

    /** protojson omits false booleans, so absence means false. */
    private fun JsonObject.flag(vararg keys: String): Boolean =
        keys.firstNotNullOfOrNull { (this[it] as? JsonPrimitive)?.booleanOrNull } ?: false

    private fun JsonObject.array(key: String): JsonArray = (this[key] as? JsonArray) ?: JsonArray(emptyList())
}
