/**
 * The extension pages run with WXT's `browser` global in scope. The e2e
 * specs evaluate code *inside* those pages, where an import would not
 * survive serialisation, so the global is declared here instead.
 */
declare const browser: {
  storage: {
    local: {
      get(keys: string | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
};
