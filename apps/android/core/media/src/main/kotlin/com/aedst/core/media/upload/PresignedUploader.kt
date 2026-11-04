package com.aedst.core.media.upload

import com.aedst.core.common.AedstError
import com.aedst.core.network.ExternalHttpClient
import okhttp3.MediaType
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.coroutines.executeAsync
import okio.BufferedSink
import okio.buffer
import okio.source
import java.io.File
import java.io.IOException
import javax.inject.Inject

/** Where and how to PUT one staged file: the presigned URL, verb and signed headers returned by `CreateUpload`. */
data class PresignedTarget(
    val url: String,
    val method: String,
    val headers: Map<String, String>,
    val fallbackContentType: String,
)

/**
 * PUTs a file straight to object storage with the presigned URL from `CreateUpload` — bytes never pass through the
 * API server. Uses the [ExternalHttpClient] (no bearer token, no first-party headers, no API pinning).
 *
 * Throws [AedstError]: `Unavailable` (retry), `InvalidInput` (the URL expired or the signature/headers were rejected:
 * a new `CreateUpload` is needed), `Unknown` for anything else.
 */
class PresignedUploader @Inject constructor(@ExternalHttpClient private val client: OkHttpClient) {

    suspend fun upload(file: File, target: PresignedTarget, onProgress: (sentBytes: Long, totalBytes: Long) -> Unit) {
        // The body's media type becomes the Content-Type header; it must equal the signed one byte for byte.
        val signedContentType = target.headers.entries
            .firstOrNull { it.key.equals("Content-Type", ignoreCase = true) }?.value
        val body = ProgressRequestBody(
            file,
            (signedContentType ?: target.fallbackContentType).toMediaTypeOrNull(),
            onProgress,
        )
        val request = Request.Builder()
            .url(target.url)
            .apply { target.headers.forEach { (name, value) -> header(name, value) } }
            .method(target.method.uppercase(), body)
            .build()

        // okhttp-coroutines: cancelling the coroutine cancels the call; no dispatcher is needed (OkHttp's own pool).
        val code = try {
            client.newCall(request).executeAsync().use { it.code }
        } catch (io: IOException) {
            throw AedstError.Unavailable(io.message ?: "Upload I/O error", io)
        }
        val failure: AedstError? = when (code) {
            in HTTP_OK_RANGE -> null
            HTTP_FORBIDDEN, HTTP_BAD_REQUEST -> AedstError.InvalidInput("Presigned upload rejected: HTTP $code")
            HTTP_TOO_MANY_REQUESTS, in HTTP_SERVER_ERROR_RANGE -> AedstError.Unavailable("Upload failed: HTTP $code")
            else -> AedstError.Unknown("Upload failed: HTTP $code")
        }
        if (failure != null) throw failure
    }

    private companion object {
        val HTTP_OK_RANGE = 200..299
        val HTTP_SERVER_ERROR_RANGE = 500..599
        const val HTTP_BAD_REQUEST = 400
        const val HTTP_FORBIDDEN = 403
        const val HTTP_TOO_MANY_REQUESTS = 429
    }
}

/** Streams [file] in chunks and reports progress; OkHttp may call [writeTo] again on a retry, which restarts it. */
internal class ProgressRequestBody(
    private val file: File,
    private val mediaType: MediaType?,
    private val onProgress: (sentBytes: Long, totalBytes: Long) -> Unit,
) : RequestBody() {

    override fun contentType(): MediaType? = mediaType

    override fun contentLength(): Long = file.length()

    override fun writeTo(sink: BufferedSink) {
        val total = contentLength()
        var sent = 0L
        file.source().buffer().use { source ->
            while (true) {
                val read = source.read(sink.buffer, CHUNK_BYTES)
                if (read == -1L) break
                sink.emit()
                sent += read
                onProgress(sent, total)
            }
        }
    }

    private companion object {
        const val CHUNK_BYTES = 64L * 1024
    }
}
