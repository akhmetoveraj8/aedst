import { join } from "node:path";
import { loadPages } from "./content";

export const CONTENT_DIR = join(process.cwd(), "content");

export function allPages() {
  return loadPages(CONTENT_DIR);
}
