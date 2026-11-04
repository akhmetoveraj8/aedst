// Tiny JSON helper shared by the Claude Code hook scripts (no jq dependency: jq is not
// guaranteed on Windows, Node is a repo prerequisite).
//
//   node hook-io.mjs field <name>     read hook JSON on stdin, print one field:
//       file_path   tool_input.file_path (or notebook_path / path), repo-relative with "/" separators
//       command     tool_input.command (Bash hooks)
//       stop_active "true" / "false" (Stop hooks: stop_hook_active)
//       session_id  session id or "unknown"
//   node hook-io.mjs deny   <reason>  print a PreToolUse deny decision as JSON
//   node hook-io.mjs block            read the reason from stdin, print a Stop block decision as JSON
//   node hook-io.mjs context          read text from stdin, print it as SessionStart additionalContext JSON
//
// Invalid or empty input prints an empty value and exits 0 (a hook must never crash on `{}`).
import path from "node:path";
import { readFileSync } from "node:fs";

const [, , command, arg] = process.argv;

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseJson(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

// "/c/Users/x" (MSYS) -> "C:/Users/x"; backslashes -> "/".
function toPosix(p) {
  let out = p.replace(/\\/g, "/");
  const msys = /^\/([a-zA-Z])\/(.*)$/.exec(out);
  if (msys) out = `${msys[1].toUpperCase()}:/${msys[2]}`;
  return out;
}

function repoRelative(filePath) {
  const root = toPosix(process.env.CLAUDE_PROJECT_DIR || process.cwd()).replace(/\/+$/, "");
  const target = toPosix(filePath);
  const winLike = /^[A-Za-z]:\//.test(root);
  const norm = (s) => (winLike ? s.toLowerCase() : s);
  if (!path.isAbsolute(target) && !/^[A-Za-z]:\//.test(target)) return target.replace(/^\.\//, "");
  if (norm(target).startsWith(`${norm(root)}/`)) return target.slice(root.length + 1);
  return target;
}

if (command === "field") {
  const input = parseJson(readStdin());
  const tool = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  if (arg === "file_path") {
    const raw = tool.file_path ?? tool.notebook_path ?? tool.path ?? "";
    process.stdout.write(typeof raw === "string" && raw !== "" ? repoRelative(raw) : "");
  } else if (arg === "command") {
    process.stdout.write(typeof tool.command === "string" ? tool.command : "");
  } else if (arg === "stop_active") {
    process.stdout.write(input.stop_hook_active === true ? "true" : "false");
  } else if (arg === "session_id") {
    process.stdout.write(typeof input.session_id === "string" && input.session_id ? input.session_id.replace(/[^A-Za-z0-9_-]/g, "") : "unknown");
  }
} else if (command === "deny") {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: arg ?? "denied",
      },
    })}\n`,
  );
} else if (command === "block") {
  const reason = readStdin().trim() || "blocked";
  process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
} else if (command === "context") {
  const additionalContext = readStdin().trim();
  if (additionalContext) {
    process.stdout.write(`${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } })}\n`);
  }
} else {
  process.stderr.write("usage: hook-io.mjs field <file_path|stop_active|session_id> | deny <reason> | block | context\n");
  process.exit(64);
}
