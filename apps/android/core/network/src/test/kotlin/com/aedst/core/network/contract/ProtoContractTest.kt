package com.aedst.core.network.contract

import com.connectrpc.StreamType
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.fail
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Contract test of the generated connect-kotlin client against the server's proto descriptors: the Android analogue
 * of apps/web's `mock-api.contract.test.ts`. The descriptors come from `make descriptors` (`buf build` of
 * `apps/server/api/proto`, JSON `FileDescriptorSet`), the client side is inspected by reflection on the generated
 * `*ServiceClient` / `*ServiceClientInterface` (see [GeneratedClientProbe]).
 *
 * It checks that
 * 1. every service in the descriptors has a generated client (so `make generate`'s path list cannot lag behind);
 * 2. every RPC has a matching suspend method whose request/response classes, wire path and stream kind equal the
 *    descriptor's, and the interface has no method the descriptors lack;
 * 3. every RPC in [AppRpcContract] (what the app really calls) exists in the descriptors with the expected kind.
 *
 * With `AEDST_REQUIRE_CONTRACT` set (CI) a missing descriptor file fails the build; locally the test is skipped with a
 * message pointing at `make descriptors`.
 */
class ProtoContractTest {

    @Test
    fun `every service in the descriptors has a generated client`() {
        val missing = services.filter { runCatching { GeneratedClientProbe(it) }.isFailure }.map { it.name }

        assertTrue(
            missing.isEmpty(),
            "No generated client for $missing: add its proto to the Makefile generate paths",
        )
    }

    @Test
    fun `generated clients match the descriptors rpc by rpc`() {
        val problems = services.flatMap { service ->
            val probe = GeneratedClientProbe(service)
            service.rpcs.flatMap { rpc -> checkRpc(probe, rpc) } + staleMethods(probe, service)
        }

        assertTrue(
            problems.isEmpty(),
            "Generated client drifted from the proto descriptors:\n${problems.joinToString("\n")}",
        )
    }

    @Test
    fun `rpcs used by the app exist in the descriptors with the expected stream kind`() {
        val byPath = services.flatMap { it.rpcs }.associateBy { it.path }
        val expected = AppRpcContract.unary.associateWith { StreamType.UNARY } + AppRpcContract.streaming

        val problems = expected.mapNotNull { (path, kind) ->
            val rpc = byPath[path]
            when {
                rpc == null -> "$path: not in the descriptors (renamed or removed on the server?)"
                rpc.streamType != kind -> "$path: app expects $kind, descriptors say ${rpc.streamType}"
                else -> null
            }
        }

        assertTrue(problems.isEmpty(), "App RPC contract broken:\n${problems.joinToString("\n")}")
    }

    private fun checkRpc(probe: GeneratedClientProbe, rpc: RpcDescriptor): List<String> {
        val method = probe.interfaceMethod(rpc)
            ?: return listOf("${rpc.path}: no ${probe.kotlinName(rpc)}() on the client")
        val spec = probe.captureSpec(rpc, method)
        return listOfNotNull(
            "${rpc.path}: wire path is ${spec.path}".takeIf { spec.path != rpc.path },
            "${rpc.path}: request is ${spec.requestClass.java.name}, descriptor says ${rpc.inputType}"
                .takeIf { spec.requestClass.java.name != messageClassName(rpc.inputType) },
            "${rpc.path}: response is ${spec.responseClass.java.name}, descriptor says ${rpc.outputType}"
                .takeIf { spec.responseClass.java.name != messageClassName(rpc.outputType) },
            "${rpc.path}: stream type is ${spec.streamType}, descriptor says ${rpc.streamType}"
                .takeIf { spec.streamType != rpc.streamType },
        )
    }

    /** Interface methods without a descriptor RPC: the server dropped an RPC but the client was not regenerated. */
    private fun staleMethods(probe: GeneratedClientProbe, service: ServiceDescriptor): List<String> {
        val expected = service.rpcs.map(probe::kotlinName).toSet()
        return probe.clientInterface.declaredMethods
            .filterNot { it.isSynthetic || it.name in expected }
            .map { "${service.protoPackage}.${service.name}: client method ${it.name}() has no RPC in the descriptors" }
    }

    /** `.aedst.auth.v1.LoginRequest` to the buf-managed Java class `com.aedst.auth.v1.LoginRequest`. */
    private fun messageClassName(protoType: String): String = "com$protoType"

    companion object {
        /** Server services with no Android client: Apple App Attest (Android attests with Play Integrity). */
        private val NOT_FOR_ANDROID = setOf("aedst.appattest.v1")

        private lateinit var services: List<ServiceDescriptor>

        @BeforeAll
        @JvmStatic
        fun loadDescriptors() {
            val file = System.getProperty("aedst.descriptors")?.let(::File)
            if (file == null || !file.isFile) {
                val message = "Proto descriptors not found at ${file?.path}. Run `make descriptors` in apps/android."
                if (System.getenv("AEDST_REQUIRE_CONTRACT").isNullOrBlank()) {
                    assumeTrue(false, "$message (set AEDST_REQUIRE_CONTRACT=1 to make this mandatory)")
                } else {
                    fail<Unit>("$message AEDST_REQUIRE_CONTRACT is set, so the contract test is mandatory.")
                }
            }
            services = ProtoDescriptors.load(checkNotNull(file)).filterNot { it.protoPackage in NOT_FOR_ANDROID }
            assertTrue(services.isNotEmpty(), "No services found in $file")
        }
    }
}
