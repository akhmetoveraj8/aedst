import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

// Built-in full-text search over the same content tree (replaces the Pagefind index).
export const { GET } = createFromSource(source);
