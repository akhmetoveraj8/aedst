import assert from "node:assert/strict";
import test from "node:test";
import { filesByPackage, toFile } from "./descriptor.mjs";
import { generate, openapiPagePath, pagePath, routeOf } from "./index.mjs";
import { constraints } from "./render.mjs";

// A FileDescriptorSet in the shape `buf build -o -#format=json` prints (protojson names).
const FILE = {
  name: "aedst/a/v1/a.proto",
  package: "aedst.a.v1",
  messageType: [
    {
      name: "GetRequest",
      field: [
        { name: "id", number: 1, label: "LABEL_OPTIONAL", type: "TYPE_STRING", jsonName: "id",
          options: { "[buf.validate.field]": { string: { uuid: true } } } },
        { name: "kinds", number: 2, label: "LABEL_REPEATED", type: "TYPE_ENUM", typeName: ".aedst.a.v1.Kind", jsonName: "kinds",
          options: { "[buf.validate.field]": { repeated: { items: { enum: { definedOnly: true, notIn: [0] } } } } } },
        { name: "labels", number: 3, label: "LABEL_REPEATED", type: "TYPE_MESSAGE", typeName: ".aedst.a.v1.GetRequest.LabelsEntry", jsonName: "labels" },
        { name: "version", number: 4, label: "LABEL_OPTIONAL", type: "TYPE_INT32", jsonName: "version", oneofIndex: 1, proto3Optional: true,
          options: { "[buf.validate.field]": { int32: { lte: 100, gte: 0 } } } },
        { name: "a", number: 5, label: "LABEL_OPTIONAL", type: "TYPE_STRING", jsonName: "a", oneofIndex: 0 },
        { name: "at", number: 6, label: "LABEL_OPTIONAL", type: "TYPE_MESSAGE", typeName: ".google.protobuf.Timestamp", jsonName: "at" },
      ],
      nestedType: [
        { name: "LabelsEntry", options: { mapEntry: true }, field: [
          { name: "key", number: 1, type: "TYPE_STRING" }, { name: "value", number: 2, type: "TYPE_STRING" }] },
        { name: "Inner", field: [{ name: "x", number: 1, label: "LABEL_OPTIONAL", type: "TYPE_STRING", jsonName: "x" }] },
      ],
      oneofDecl: [{ name: "pick" }, { name: "_version" }],
    },
    { name: "GetResponse" },
  ],
  enumType: [{ name: "Kind", value: [{ name: "KIND_UNSPECIFIED", number: 0 }, { name: "KIND_A", number: 1 }] }],
  service: [{ name: "Svc", method: [
    { name: "Get", inputType: ".aedst.a.v1.GetRequest", outputType: ".aedst.a.v1.GetResponse", options: { idempotencyLevel: "NO_SIDE_EFFECTS" } },
  ] }],
  sourceCodeInfo: { location: [
    { path: [6, 0], leadingComments: " Svc does things.\n" },
    { path: [6, 0, 2, 0], leadingComments: " Gets one.\n Second line.\n" },
    { path: [4, 0, 2, 0], leadingComments: " The id.\n" },
    { path: [5, 0, 2, 1], leadingComments: " Kind A.\n" },
  ] },
};
const SET = { file: [{ name: "google/protobuf/timestamp.proto", package: "google.protobuf" }, FILE] };

test("maps services, comments, fields, map, optional, oneof and nesting from a descriptor", () => {
  const f = toFile(FILE);
  assert.equal(f.package, "aedst.a.v1");
  assert.equal(f.services[0].doc, "Svc does things.");
  assert.deepEqual(
    { ...f.services[0].rpcs[0] },
    { name: "Get", doc: "Gets one.\nSecond line.", request: "GetRequest", response: "GetResponse", clientStream: false, serverStream: false, noSideEffects: true },
  );
  const req = f.messages[0];
  assert.equal(req.fields.length, 6);
  assert.equal(req.fields[0].doc, "The id.");
  assert.equal(req.fields[1].type, "Kind");
  assert.equal(req.fields[1].label, "repeated");
  assert.equal(req.fields[2].type, "map<string, string>");
  assert.equal(req.fields[2].label, "");
  assert.equal(req.fields[3].label, "optional");
  assert.equal(req.fields[3].oneof, "");
  assert.equal(req.fields[4].oneof, "pick");
  assert.equal(req.fields[5].type, "google.protobuf.Timestamp");
  assert.deepEqual(req.nested.map((n) => n.name), ["GetRequest.Inner"]);
  assert.equal(f.enums[0].values[1].doc, "Kind A.");
});

test("humanises validation rules in a fixed order", () => {
  const [id, kinds, , version] = toFile(FILE).messages[0].fields;
  assert.equal(constraints(id.rules), "UUID");
  assert.equal(constraints(kinds.rules), "each: known value, not UNSPECIFIED");
  assert.equal(constraints(version.rules), "≥ 0, ≤ 100");
  assert.equal(constraints(null), "");
});

test("groups AEDST packages only and renders one page per package at its module path", () => {
  assert.deepEqual([...filesByPackage(SET).keys()], ["aedst.a.v1"]);
  const pages = generate(SET);
  assert.deepEqual([...pages.keys()], ["docs/content/modules/a/api.md"]);
  const page = pages.get("docs/content/modules/a/api.md");
  assert.match(page, /\| \[Get\]\(#get\) \| `\/aedst\.a\.v1\.Svc\/Get` \| Gets one\. \|/);
  assert.match(page, /\/openapi\/aedst\.a\.v1\.yaml/);
  assert.match(page, /\[interactive OpenAPI page\]\(\/modules\/a\/openapi\)/);
  assert.match(page, /No side effects/);
  assert.equal(pagePath("events"), "docs/content/api/events.md");
  assert.equal(openapiPagePath("events"), "docs/content/api/events-openapi.mdx");
  assert.equal(routeOf(openapiPagePath("events")), "/api/events-openapi");
});
