import assert from "node:assert/strict";
import test from "node:test";
import { parseProto } from "./parse-proto.mjs";
import { constraints } from "./render.mjs";

const SRC = `syntax = "proto3";
package a.v1;
// Svc does things.
service Svc {
  // Gets one.
  rpc Get(GetRequest) returns (GetResponse);
}
enum Kind { KIND_UNSPECIFIED = 0; KIND_A = 1; }
message GetRequest {
  // The id.
  string id = 1 [(buf.validate.field).string.uuid = true];
  repeated Kind kinds = 2 [(buf.validate.field).repeated.items.enum = {
    defined_only: true
    not_in: [0]
  }];
  map<string, string> labels = 3;
  optional int32 version = 4;
  oneof pick { string a = 5; string b = 6; }
  message Inner { string x = 1; }
  reserved 9;
}
message GetResponse {}
`;

test("parses service, rpc docs, fields, options, oneof, map and nesting", () => {
  const f = parseProto(SRC);
  assert.equal(f.package, "a.v1");
  assert.equal(f.services[0].doc, "Svc does things.");
  assert.equal(f.services[0].rpcs[0].doc, "Gets one.");
  const req = f.messages[0];
  assert.equal(req.fields.length, 6);
  assert.equal(req.fields[0].doc, "The id.");
  assert.equal(req.fields[2].type, "map<string, string>");
  assert.equal(req.fields[3].label, "optional");
  assert.equal(req.fields[4].oneof, "pick");
  assert.equal(req.nested[0].name, "GetRequest.Inner");
  assert.equal(f.enums[0].values.length, 2);
});

test("humanises validation options", () => {
  const f = parseProto(SRC);
  const [id, kinds] = f.messages[0].fields;
  assert.equal(constraints(id.options), "UUID");
  assert.equal(constraints(kinds.options), "each: known value, not UNSPECIFIED");
});
