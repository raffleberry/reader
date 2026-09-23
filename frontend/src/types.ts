/**
 * The slice of the epub.js Rendition our app uses.
 * (epubjs types Rendition as a class; depending on the narrow
 * structural surface below keeps us immune to its churn.)
 */
export interface BookRendition {
  display(href?: string): Promise<void>;
  prev(): Promise<void>;
  next(): Promise<void>;
  getContents(): unknown;
  hooks: unknown;
}

export interface ContentHook {
  register(fn: (c: { document: Document | null }) => void): void;
}

export function contentHook(rendition: BookRendition): ContentHook {
  return (rendition.hooks as { content: ContentHook }).content;
}
