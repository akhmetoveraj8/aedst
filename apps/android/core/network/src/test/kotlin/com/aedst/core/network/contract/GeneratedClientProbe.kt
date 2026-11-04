package com.aedst.core.network.contract

import com.connectrpc.MethodSpec
import com.connectrpc.ProtocolClientInterface
import com.connectrpc.StreamType
import java.lang.reflect.InvocationHandler
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Method
import java.lang.reflect.Proxy
import kotlin.coroutines.Continuation
import kotlin.coroutines.EmptyCoroutineContext

/** Thrown by the recording protocol client to abort the call once the [MethodSpec] has been captured. */
private class SpecCaptured(val spec: MethodSpec<*, *>) : RuntimeException(null, null, false, false)

/**
 * Looks at a connect-kotlin generated client without any network or Android runtime: instantiates
 * `<Service>Client` over a recording [ProtocolClientInterface] proxy, invokes the generated suspend method (a suspend
 * function is a plain `(args..., Continuation)` method on the JVM; the generated body calls the protocol client before
 * its first suspension point) and captures the [MethodSpec] it passes - the wire path, request/response classes and
 * stream type that the real client would put on the wire.
 */
class GeneratedClientProbe(private val service: ServiceDescriptor) {

    private val clientClass: Class<*> = Class.forName("com.${service.protoPackage}.${service.name}Client")

    /** The generated `<Service>ClientInterface` (what repositories depend on). */
    val clientInterface: Class<*> = Class.forName("com.${service.protoPackage}.${service.name}ClientInterface")

    /** The Kotlin method name connect-kotlin generates for [rpc]: lowerCamelCase of the RPC name. */
    fun kotlinName(rpc: RpcDescriptor): String = rpc.method.replaceFirstChar { it.lowercase() }

    /** The generated interface method for [rpc], or null when the client has no such method. */
    fun interfaceMethod(rpc: RpcDescriptor): Method? =
        clientInterface.methods.firstOrNull { it.name == kotlinName(rpc) }

    /** Invokes the client method for [rpc] and returns the [MethodSpec] it passed to the protocol client. */
    fun captureSpec(rpc: RpcDescriptor, method: Method): MethodSpec<*, *> {
        val client = clientClass.getConstructor(ProtocolClientInterface::class.java).newInstance(recorder())
        val headers: Map<String, List<String>> = emptyMap()
        val arguments = if (rpc.streamType == StreamType.UNARY) {
            arrayOf(defaultInstance(method.parameterTypes.first()), headers, noopContinuation)
        } else {
            arrayOf(headers, noopContinuation)
        }
        try {
            method.invoke(client, *arguments)
        } catch (@Suppress("SwallowedException") e: InvocationTargetException) {
            val cause = e.targetException
            if (cause is SpecCaptured) return cause.spec
            throw cause
        }
        error("${rpc.path}: the generated client did not call the protocol client")
    }

    private fun recorder(): ProtocolClientInterface = Proxy.newProxyInstance(
        ProtocolClientInterface::class.java.classLoader,
        arrayOf(ProtocolClientInterface::class.java),
        InvocationHandler { _, _, args ->
            val spec = args.orEmpty().filterIsInstance<MethodSpec<*, *>>().firstOrNull()
            throw spec?.let(::SpecCaptured) ?: IllegalStateException("protocol client call without a MethodSpec")
        },
    ) as ProtocolClientInterface

    private fun defaultInstance(messageClass: Class<*>): Any =
        checkNotNull(messageClass.getMethod("getDefaultInstance").invoke(null)) { "no default instance" }

    private companion object {
        val noopContinuation = object : Continuation<Any?> {
            override val context = EmptyCoroutineContext

            override fun resumeWith(result: Result<Any?>) = Unit
        }
    }
}
