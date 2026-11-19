// Example JSON for the Connect JSON mapping (lowerCamelCase names, enums by name,
// int64 as strings, Timestamp as RFC 3339, bytes as base64).

const UUID = "0192f3c4-7a1e-7b52-9d3e-4c1f8a6b2e10";
const NOW = "2026-11-19T09:30:00Z";

// Realistic values by field name; anything else falls back to the type.
const BY_NAME = {
  title: "Write the release notes",
  description: "Draft the changelog and tag v1.4.0",
  search: "release",
  query: "release notes",
  q: "release",
  filename: "photo.png",
  content_type: "image/png",
  size_bytes: "482113",
  url: "https://cdn.example.com/m/0192f3c4.png",
  token: "device-or-push-token",
  platform: "android",
  locale: "en",
  kind: "task_completed",
  body: "Your task was completed.",
  snippet: "Draft the release notes",
  idempotency_key: "7d0c1e5a-3f0b-4f4e-9d51-0a2b3c4d5e6f",
  next_page_token: "",
  page_token: "",
};

export function camel(s) {
  return s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

const SCALAR = {
  string: (n) => BY_NAME[n] ?? n.replace(/_/g, " "),
  bool: () => true,
  int32: () => 1, uint32: () => 1, sint32: () => 1, fixed32: () => 1, sfixed32: () => 1,
  int64: () => "1", uint64: () => "1", sint64: () => "1", fixed64: () => "1", sfixed64: () => "1",
  float: () => 1.5, double: () => 1.5,
  bytes: () => "c2FtcGxl",
};

const WELL_KNOWN = {
  "google.protobuf.Timestamp": () => NOW,
  "google.protobuf.Duration": () => "30s",
  "google.protobuf.FieldMask": () => "title,priority",
  "google.protobuf.Struct": () => ({}),
};

export function makeSampler(index) {
  // index: Map name -> {kind: "message"|"enum", def}
  const find = (type, scope) => {
    const short = type.split(".").pop();
    return index.get(`${scope}.${type}`) ?? index.get(type) ?? index.get(short);
  };

  function sampleMessage(msg, depth, skip = new Set()) {
    const out = {};
    for (const f of msg.fields) {
      if (skip.has(f.name)) continue;
      out[camel(f.name)] = sampleField(f, depth);
    }
    return out;
  }

  function sampleType(f, type, depth) {
    if (WELL_KNOWN[type]) return WELL_KNOWN[type]();
    if (SCALAR[type]) {
      if (type === "string" && !BY_NAME[f.name]) {
        if (/(^|_)ids?$|_by$/.test(f.name)) return UUID;
        if (/(^|_)url$/.test(f.name)) return "https://storage.example.com/upload/0192f3c4";
        if (f.name === "link") return "/tasks/0192f3c4-7a1e-7b52-9d3e-4c1f8a6b2e10";
      }
      return SCALAR[type](f.name);
    }
    const hit = find(type, "");
    if (hit?.kind === "enum") return (hit.def.values.find((v) => v.number !== 0) ?? hit.def.values[0]).name;
    if (hit?.kind === "message") return depth > 2 ? {} : sampleMessage(hit.def, depth + 1);
    return null;
  }

  function sampleField(f, depth) {
    const map = f.type.match(/^map<\s*\w+,\s*([\w.]+)>$/);
    if (map) return { example: sampleType({ name: "value" }, map[1], depth) };
    const v = sampleType(f, f.type, depth);
    return f.label === "repeated" ? [v] : v;
  }

  return { sampleMessage };
}
