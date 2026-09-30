/**
 * The slice of the foliate-js viewer our app uses. The vendored modules are
 * untyped JavaScript; the facades in src/foliate/ carry the types, and the
 * rest of the app depends only on the narrow surfaces below.
 */
import type { FoliateBook } from "./foliate/book";
import type { ReaderView } from "./foliate/render";

export type ThemeName = "light" | "sepia" | "dark" | "monokai";
/** Whether the speech helper answered the last probe. */
export type ServerState = "unknown" | "up" | "down";

/** The open foliate book plus the renderer showing it. */
export interface OpenViewer {
  book: FoliateBook;
  view: ReaderView;
}
