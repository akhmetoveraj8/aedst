import {
  authenticate,
  findTask,
  invalid,
  MOCK_ORIGIN,
  nextId,
  notFound,
  paginate,
  RpcError,
  state,
} from "./core.mjs";

function mediaKind(contentType) {
  if (contentType.startsWith("image/")) return "MEDIA_KIND_IMAGE";
  if (contentType.startsWith("video/")) return "MEDIA_KIND_VIDEO";
  if (contentType.startsWith("audio/")) return "MEDIA_KIND_AUDIO";
  return "MEDIA_KIND_DOCUMENT";
}

function publicMedia(m) {
  const ready = m.status === "MEDIA_STATUS_READY";
  const objectUrl = `${MOCK_ORIGIN}/__storage/${m.id}`;
  return {
    id: m.id,
    kind: m.kind,
    status: m.status,
    filename: m.filename,
    contentType: m.contentType,
    sizeBytes: String(m.sizeBytes),
    url: ready ? objectUrl : "",
    // The mock serves the original for every imgproxy preset (ADR-0015).
    variants:
      ready && m.kind === "MEDIA_KIND_IMAGE"
        ? [
            ["VARIANT_KIND_THUMB_64", 64, 64],
            ["VARIANT_KIND_AVATAR_256", 256, 256],
            ["VARIANT_KIND_CARD_400", 400, 0],
            ["VARIANT_KIND_FEED_800X600", 800, 600],
            ["VARIANT_KIND_STORY_1080X1350", 1080, 1350],
          ].map(([kind, width, height]) => ({
            kind,
            url: objectUrl,
            width,
            height,
          }))
        : [],
    taskId: m.taskId || undefined,
    createdAt: m.createdAt,
  };
}

function ownedMedia(user, id) {
  const media = state.media.get(id);
  if (!media || media.ownerId !== user.id) throw notFound("media");
  return media;
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const media = {
  CreateUpload(body, req) {
    const user = authenticate(req);
    const size = Number(body.sizeBytes ?? 0);
    if (!body.filename || !body.contentType || size <= 0) {
      throw invalid("filename, content_type and size_bytes are required");
    }
    if (size > MAX_UPLOAD_BYTES) {
      throw new RpcError(429, "resource_exhausted", "file too large");
    }
    if (body.taskId) findTask(user, body.taskId);
    const record = {
      id: nextId(),
      ownerId: user.id,
      kind: mediaKind(body.contentType),
      status: "MEDIA_STATUS_PENDING_UPLOAD",
      filename: body.filename,
      contentType: body.contentType,
      sizeBytes: size,
      taskId: body.taskId ?? "",
      createdAt: new Date().toISOString(),
      bytes: null,
    };
    state.media.set(record.id, record);
    return {
      media: publicMedia(record),
      uploadUrl: `${MOCK_ORIGIN}/__storage/${record.id}`,
      method: "PUT",
      headers: { "Content-Type": body.contentType },
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
  },
  CompleteUpload(body, req) {
    const record = ownedMedia(authenticate(req), body.id);
    if (!record.bytes) {
      throw new RpcError(400, "failed_precondition", "object not uploaded");
    }
    record.status = "MEDIA_STATUS_READY";
    return { media: publicMedia(record) };
  },
  GetMedia(body, req) {
    return { media: publicMedia(ownedMedia(authenticate(req), body.id)) };
  },
  ListMedia(body, req) {
    const user = authenticate(req);
    const kinds = body.kinds ?? [];
    const rows = [...state.media.values()]
      .filter(
        (m) =>
          m.ownerId === user.id &&
          m.status !== "MEDIA_STATUS_PENDING_UPLOAD" &&
          (!body.taskId || m.taskId === body.taskId) &&
          (kinds.length === 0 || kinds.includes(m.kind)),
      )
      .reverse();
    const { page, nextPageToken } = paginate(rows, body);
    return { media: page.map(publicMedia), nextPageToken };
  },
  DeleteMedia(body, req) {
    const record = ownedMedia(authenticate(req), body.id);
    state.media.delete(record.id);
    return {};
  },
};
