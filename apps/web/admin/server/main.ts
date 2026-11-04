// Entry point. Importing `bootstrap` validates the environment and mirrors it
// into the variables the shared auth kit reads when it is first imported; the
// dynamic import guarantees that every module touching the kit loads after it,
// whatever order an import sorter would choose.
import "./bootstrap";

await import("./start");
