import { authenticate, invalid, paginate, state } from "./core.mjs";

const HL_START = "";
const HL_END = "";

/** Wraps case-insensitive occurrences of `term` in the highlight markers. */
function highlight(text, term) {
  if (!term) return text;
  const lower = text.toLowerCase();
  let out = "";
  let at = 0;
  for (;;) {
    const found = lower.indexOf(term, at);
    if (found === -1) break;
    out += `${text.slice(at, found)}${HL_START}${text.slice(found, found + term.length)}${HL_END}`;
    at = found + term.length;
  }
  return out + text.slice(at);
}

export const search = {
  Search(body, req) {
    const user = authenticate(req);
    const term = String(body.query ?? "")
      .trim()
      .toLowerCase();
    if (!term) {
      throw invalid("query is required");
    }
    const kinds = body.kinds ?? [];
    const wantTasks =
      kinds.length === 0 || kinds.includes("DOCUMENT_KIND_TASK");
    const wantMedia =
      kinds.length === 0 || kinds.includes("DOCUMENT_KIND_MEDIA");
    const hits = [];
    if (wantTasks) {
      for (const task of user.tasks) {
        const haystack = `${task.title} ${task.description}`.toLowerCase();
        if (haystack.includes(term)) {
          hits.push({
            kind: "DOCUMENT_KIND_TASK",
            id: task.id,
            title: highlight(task.title, term),
            snippet: highlight(task.description || task.title, term),
            score: 1,
            link: `/tasks/${task.id}`,
            updatedAt: task.updatedAt,
          });
        }
      }
    }
    if (wantMedia) {
      for (const media of state.media.values()) {
        if (
          media.ownerId === user.id &&
          media.filename.toLowerCase().includes(term)
        ) {
          hits.push({
            kind: "DOCUMENT_KIND_MEDIA",
            id: media.id,
            title: highlight(media.filename, term),
            snippet: "",
            score: 0.5,
            link: media.taskId ? `/tasks/${media.taskId}` : "/search",
            updatedAt: media.createdAt,
          });
        }
      }
    }
    const { page, nextPageToken } = paginate(hits, body, 20, 50);
    return {
      hits: page,
      nextPageToken,
      totalEstimate: body.pageToken ? 0 : hits.length,
    };
  },
  Suggest(body, req) {
    const user = authenticate(req);
    const prefix = String(body.prefix ?? "").toLowerCase();
    const limit = Math.min(body.limit || 8, 20);
    return {
      suggestions: user.tasks
        .map((task) => task.title)
        .filter((title) => title.toLowerCase().startsWith(prefix))
        .slice(0, limit),
    };
  },
};
