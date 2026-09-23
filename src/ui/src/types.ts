/**
 * The slice of the epub.js Rendition our app uses.
 * (epubjs types Rendition as a class; depending on the narrow
 * structural surface below keeps us immune to its churn.)
 */
export interface RelocatedPage {
  page: number;
  total: number;
}

export interface RelocatedStart {
  cfi: string;
  href: string;
  index: number;
  /** 0-based book location; present only after locations.generate(). */
  location?: number;
  percentage?: number;
  displayed: RelocatedPage;
}

export interface RelocatedLocation {
  start: RelocatedStart;
  end: RelocatedStart;
}

export interface BookLocations {
  generate(chars: number): Promise<unknown>;
  length(): number;
  cfiFromLocation(loc: number): string;
  locationFromCfi(cfi: string): number;
}

export interface SpineSection {
  index: number;
  href: string;
  linear: boolean;
}

export interface BookSpine {
  length: number;
  get(target: string | number): SpineSection | null;
}

export interface RenditionBook {
  locations: BookLocations;
  spine: BookSpine;
}

export interface BookRendition {
  display(href?: string): Promise<void>;
  prev(): Promise<void>;
  next(): Promise<void>;
  resize(): void;
  getContents(): unknown;
  hooks: unknown;
  on(event: string, cb: (loc: RelocatedLocation) => void): void;
  off(event: string, cb: (loc: RelocatedLocation) => void): void;
  book?: RenditionBook;
}

export interface ContentHook {
  register(fn: (c: { document: Document | null }) => void): void;
}

export function contentHook(rendition: BookRendition): ContentHook {
  return (rendition.hooks as { content: ContentHook }).content;
}
