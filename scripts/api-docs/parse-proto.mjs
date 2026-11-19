// Minimal proto3 parser for the AEDST contracts (Node built-ins only).
// Handles: package, service/rpc, message (nested), enum, oneof, map, repeated, optional, reserved, field options.
// Leading `//` comments directly above an element become its `doc`.

const TOKEN = /\s*(?:(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|([A-Za-z_][\w.]*)|(-?\d+(?:\.\d+)?)|([{}()[\];=<>,:.]))/y;

export function tokenize(src) {
  const out = [];
  let lastIndex = 0;
  TOKEN.lastIndex = 0;
  const lineAt = (i) => src.slice(0, i).split("\n").length;
  for (;;) {
    TOKEN.lastIndex = lastIndex;
    const m = TOKEN.exec(src);
    if (!m) break;
    lastIndex = TOKEN.lastIndex;
    const start = lastIndex - m[0].trimStart().length;
    const text = m[0].trimStart();
    const type = m[1] ? "comment" : m[2] ? "string" : m[3] ? "ident" : m[4] ? "number" : "punct";
    out.push({ type, text, start, end: lastIndex, line: lineAt(start) });
  }
  return out;
}

export function parseProto(src) {
  const toks = tokenize(src);
  let i = 0;
  const file = { package: "", services: [], messages: [], enums: [] };

  // Gather the comment block that ends on the line before the next code token.
  const takeDoc = () => {
    const lines = [];
    let prev = null;
    while (toks[i]?.type === "comment") {
      const t = toks[i++];
      if (prev !== null && t.line !== prev + 1) lines.length = 0;
      lines.push(t.text.replace(/^\/\/ ?/, ""));
      prev = t.line;
    }
    const next = toks[i];
    return next && prev !== null && next.line === prev + 1 ? lines.join("\n").trim() : "";
  };
  const skipComments = () => { while (toks[i]?.type === "comment") i++; };
  const next = () => { skipComments(); return toks[i++]; };
  const peek = () => { skipComments(); return toks[i]; };
  const expect = (text) => {
    const t = next();
    if (t?.text !== text) throw new Error(`proto: expected ${text} got ${t?.text} at line ${t?.line}`);
  };
  const skipStatement = () => { while (next().text !== ";"); };

  function parseOptions() {
    // after '[': return source text up to the matching ']'
    const begin = toks[i].start;
    let depth = 1;
    let end = begin;
    while (depth) {
      const t = next();
      if (t.text === "[") depth++;
      else if (t.text === "]") depth--;
      end = t.start;
    }
    return src.slice(begin, end);
  }

  function parseEnum(doc) {
    const name = next().text;
    expect("{");
    const values = [];
    for (;;) {
      const d = takeDoc();
      const t = next();
      if (t.text === "}") break;
      if (t.text === "reserved" || t.text === "option") { skipStatement(); continue; }
      expect("=");
      const number = Number(next().text);
      if (peek().text === "[") { next(); parseOptions(); }
      expect(";");
      values.push({ name: t.text, number, doc: d });
    }
    return { name, doc, values };
  }

  function parseMessage(doc, parentName) {
    const name = next().text;
    expect("{");
    const msg = { name: parentName ? `${parentName}.${name}` : name, doc, fields: [], nested: [], enums: [] };
    for (;;) {
      const d = takeDoc();
      const t = next();
      if (t.text === "}") break;
      if (t.text === "reserved" || t.text === "option") { skipStatement(); continue; }
      if (t.text === "message") { msg.nested.push(parseMessage(d, msg.name)); continue; }
      if (t.text === "enum") { msg.enums.push(parseEnum(d)); continue; }
      if (t.text === "oneof") {
        const group = next().text;
        expect("{");
        for (;;) {
          const fd = takeDoc();
          const ft = next();
          if (ft.text === "}") break;
          msg.fields.push(parseField(ft, fd, group));
        }
        continue;
      }
      msg.fields.push(parseField(t, d, ""));
    }
    return msg;
  }

  function parseField(first, doc, oneof) {
    let label = "";
    let t = first;
    if (t.text === "repeated" || t.text === "optional") { label = t.text; t = next(); }
    let type = t.text;
    if (type === "map") {
      expect("<");
      const k = next().text;
      expect(",");
      const v = next().text;
      expect(">");
      type = `map<${k}, ${v}>`;
    }
    const name = next().text;
    expect("=");
    const number = Number(next().text);
    let options = "";
    if (peek().text === "[") { next(); options = parseOptions(); }
    expect(";");
    return { name, type, label, number, options, oneof, doc };
  }

  function parseService(doc) {
    const name = next().text;
    expect("{");
    const svc = { name, doc, rpcs: [] };
    for (;;) {
      const d = takeDoc();
      const t = next();
      if (t.text === "}") break;
      if (t.text === "option") { skipStatement(); continue; }
      const rpc = next().text;
      expect("(");
      let reqStream = false;
      let req = next().text;
      if (req === "stream") { reqStream = true; req = next().text; }
      expect(")");
      expect("returns");
      expect("(");
      let resStream = false;
      let res = next().text;
      if (res === "stream") { resStream = true; res = next().text; }
      expect(")");
      if (peek().text === "{") { while (next().text !== "}"); } else expect(";");
      svc.rpcs.push({ name: rpc, doc: d, request: req, response: res, clientStream: reqStream, serverStream: resStream });
    }
    return svc;
  }

  while (i < toks.length) {
    const d = takeDoc();
    const t = next();
    if (!t) break;
    if (t.text === "package") { file.package = next().text; expect(";"); }
    else if (t.text === "service") file.services.push(parseService(d));
    else if (t.text === "message") file.messages.push(parseMessage(d, ""));
    else if (t.text === "enum") file.enums.push(parseEnum(d));
    else skipStatement();
  }
  return file;
}

export function flattenMessages(msgs) {
  return msgs.flatMap((m) => [m, ...flattenMessages(m.nested)]);
}
