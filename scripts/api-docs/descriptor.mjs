// Reads the API contract from buf's descriptor output (a google.protobuf.FileDescriptorSet as
// JSON, source info included) and maps it to the small model the renderer uses. No .proto text
// is parsed here: buf is the parser (Library-First).
import { execFileSync } from "node:child_process";

// `buf build` of the server module; `cwd` is apps/server.
export function loadDescriptorSet(cwd) {
  const out = execFileSync("buf", ["build", "-o", "-#format=json"], { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return JSON.parse(out);
}

const SCALARS = {
  TYPE_DOUBLE: "double", TYPE_FLOAT: "float", TYPE_INT64: "int64", TYPE_UINT64: "uint64", TYPE_INT32: "int32",
  TYPE_FIXED64: "fixed64", TYPE_FIXED32: "fixed32", TYPE_BOOL: "bool", TYPE_STRING: "string", TYPE_BYTES: "bytes",
  TYPE_UINT32: "uint32", TYPE_SFIXED32: "sfixed32", TYPE_SFIXED64: "sfixed64", TYPE_SINT32: "sint32", TYPE_SINT64: "sint64",
};

// FileDescriptorProto field numbers, used in SourceCodeInfo paths.
const FILE_MESSAGE = 4, FILE_ENUM = 5, FILE_SERVICE = 6;
const MESSAGE_FIELD = 2, MESSAGE_NESTED = 3, MESSAGE_ENUM = 4, ENUM_VALUE = 2, SERVICE_METHOD = 2;

function commentIndex(file) {
  const docs = new Map();
  for (const loc of file.sourceCodeInfo?.location ?? []) {
    if (!loc.leadingComments) continue;
    const text = loc.leadingComments.split("\n").map((l) => l.replace(/^ /, "").trimEnd()).join("\n").trim();
    docs.set((loc.path ?? []).join("."), text);
  }
  return (path) => docs.get(path.join(".")) ?? "";
}

// One file of the descriptor set -> { package, services, messages, enums } with leading comments as `doc`.
export function toFile(file) {
  const doc = commentIndex(file);
  const pkg = file.package ?? "";
  const typeName = (full) => {
    const name = full.replace(/^\./, "");
    return name.startsWith(`${pkg}.`) ? name.slice(pkg.length + 1) : name;
  };

  const toEnum = (e, path) => ({
    name: e.name,
    doc: doc(path),
    values: (e.value ?? []).map((v, i) => ({ name: v.name, number: v.number ?? 0, doc: doc([...path, ENUM_VALUE, i]) })),
  });

  const toMessage = (m, path, parent) => {
    const name = parent ? `${parent}.${m.name}` : m.name;
    const entries = new Map((m.nestedType ?? []).filter((n) => n.options?.mapEntry).map((n) => [n.name, n]));
    const scalarOrName = (f) => SCALARS[f.type] ?? typeName(f.typeName);
    const fields = (m.field ?? []).map((f, i) => {
      const entry = f.typeName ? entries.get(f.typeName.split(".").pop()) : undefined;
      const isMap = entry && f.typeName.endsWith(`.${m.name}.${entry.name}`);
      const type = isMap ? `map<${scalarOrName(entry.field[0])}, ${scalarOrName(entry.field[1])}>` : scalarOrName(f);
      const label = isMap ? "" : f.label === "LABEL_REPEATED" ? "repeated" : f.proto3Optional ? "optional" : "";
      const oneof = f.oneofIndex !== undefined && !f.proto3Optional ? m.oneofDecl[f.oneofIndex].name : "";
      return { name: f.name, jsonName: f.jsonName, type, label, number: f.number, oneof, doc: doc([...path, MESSAGE_FIELD, i]),
        rules: f.options?.["[buf.validate.field]"] ?? null };
    });
    return {
      name, doc: doc(path), fields,
      nested: (m.nestedType ?? []).flatMap((n, i) => (n.options?.mapEntry ? [] : [toMessage(n, [...path, MESSAGE_NESTED, i], name)])),
      enums: (m.enumType ?? []).map((e, i) => toEnum(e, [...path, MESSAGE_ENUM, i])),
    };
  };

  return {
    name: file.name,
    package: pkg,
    messages: (file.messageType ?? []).map((m, i) => toMessage(m, [FILE_MESSAGE, i], "")),
    enums: (file.enumType ?? []).map((e, i) => toEnum(e, [FILE_ENUM, i])),
    services: (file.service ?? []).map((s, i) => ({
      name: s.name,
      doc: doc([FILE_SERVICE, i]),
      rpcs: (s.method ?? []).map((r, j) => ({
        name: r.name,
        doc: doc([FILE_SERVICE, i, SERVICE_METHOD, j]),
        request: typeName(r.inputType),
        response: typeName(r.outputType),
        clientStream: Boolean(r.clientStreaming),
        serverStream: Boolean(r.serverStreaming),
        noSideEffects: r.options?.idempotencyLevel === "NO_SIDE_EFFECTS",
      })),
    })),
  };
}

// The AEDST files of a descriptor set grouped by proto package, in package order.
export function filesByPackage(set, prefix = "aedst.") {
  const groups = new Map();
  for (const f of set.file ?? []) {
    if (!(f.package ?? "").startsWith(prefix)) continue;
    if (!groups.has(f.package)) groups.set(f.package, []);
    groups.get(f.package).push(toFile(f));
  }
  return new Map([...groups].sort(([a], [b]) => a.localeCompare(b)));
}

export function flattenMessages(msgs) {
  return msgs.flatMap((m) => [m, ...flattenMessages(m.nested)]);
}
