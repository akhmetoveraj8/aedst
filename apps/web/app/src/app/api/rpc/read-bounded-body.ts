/**
 * Reads a request body into one buffer, giving up as soon as it exceeds
 * `maxBytes`. `content-length` can be absent (chunked) or lie, so the limit is
 * enforced on the bytes actually received instead of buffering first and
 * checking after. Returns `null` when the body is too large.
 */
export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<ArrayBuffer | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return null;
  }
  if (!request.body) {
    return new ArrayBuffer(0);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}
